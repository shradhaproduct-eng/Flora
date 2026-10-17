import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db.js";
import { IdentifyError, identifyItem, parseImageDataUrl } from "../identify.js";
import { buildInventoryWorkbook } from "../inventoryExcel.js";

export const CATEGORIES = {
  wrapping_paper: "Wrapping paper",
  ribbon: "Ribbons",
  bloom_bag: "Bloom bags",
  greeting_card: "Greeting cards",
  tag: "Tags",
  other: "Other",
};

// Thumbnails are downscaled in the browser; this just stops a full-size
// photo from being stored in the database by mistake.
const MAX_THUMBNAIL_CHARS = 300_000;

const router = Router();
const isUniqueViolation = (err) => err.code === "23505";

function validateItem(body) {
  const errors = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.push("Item name is required.");
  const category = String(body.category ?? "");
  if (!CATEGORIES[category]) errors.push("Choose a category.");

  const quantity = body.quantity === undefined || body.quantity === "" ? 0 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 0) errors.push("Quantity must be a whole number, 0 or more.");
  const reorder_level =
    body.reorder_level === undefined || body.reorder_level === "" ? 0 : Number(body.reorder_level);
  if (!Number.isInteger(reorder_level) || reorder_level < 0) {
    errors.push("Reorder level must be a whole number, 0 or more.");
  }
  const unit_cost =
    body.unit_cost === undefined || body.unit_cost === null || body.unit_cost === "" ? null : Number(body.unit_cost);
  if (unit_cost !== null && (!Number.isFinite(unit_cost) || unit_cost < 0)) {
    errors.push("Unit cost must be a non-negative number.");
  }

  let image = body.image ?? null;
  if (image !== null) {
    if (!parseImageDataUrl(image) || image.length > MAX_THUMBNAIL_CHARS) {
      errors.push("Image must be a JPEG, PNG, WebP or GIF thumbnail.");
      image = null;
    }
  }

  return {
    errors,
    item: {
      name,
      category,
      color: String(body.color ?? "").trim(),
      unit: String(body.unit ?? "").trim() || "pcs",
      quantity,
      reorder_level,
      unit_cost,
      notes: String(body.notes ?? "").trim(),
      image,
    },
  };
}

async function logMovement(client, item, change, reason) {
  await client.query(
    `INSERT INTO inventory_movements (item_id, item_name, change, quantity_after, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [item.id, item.name, change, item.quantity, reason]
  );
}

// Runs fn inside a transaction on a dedicated client.
async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM inventory_items ORDER BY category, lower(name)");
    res.json({ categories: CATEGORIES, items: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/movements", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM inventory_movements ORDER BY created_at DESC, id DESC LIMIT 50");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Always generated from the live tables, so every download is the current
// stock — there's no stored copy to fall out of date.
router.get("/export.xlsx", async (req, res, next) => {
  try {
    const workbook = await buildInventoryWorkbook(CATEGORIES);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="buttercup-blooms-inventory-${stamp}.xlsx"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  } catch (err) {
    next(err);
  }
});

router.post("/identify", async (req, res, next) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "Photo identification isn't set up yet: add an ANTHROPIC_API_KEY environment variable to the server.",
    });
  }
  if (!parseImageDataUrl(req.body?.image)) {
    return res.status(400).json({ error: "Upload a JPEG, PNG, WebP or GIF photo." });
  }
  try {
    const { rows } = await pool.query(
      "SELECT id, name, category, color, unit, quantity FROM inventory_items ORDER BY category, lower(name)"
    );
    res.json(await identifyItem(req.body.image, rows, CATEGORIES));
  } catch (err) {
    if (err instanceof IdentifyError) return res.status(422).json({ error: err.message });
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Identification is busy right now — try again in a moment." });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: "The API key was rejected — check ANTHROPIC_API_KEY." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(err);
      return res.status(502).json({ error: "Couldn't identify that photo. Please try again." });
    }
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  const { errors, item } = validateItem(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: errors.join(" ") });
  try {
    const created = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO inventory_items (name, category, color, unit, quantity, reorder_level, unit_cost, notes, image)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [item.name, item.category, item.color, item.unit, item.quantity, item.reorder_level, item.unit_cost, item.notes, item.image]
      );
      if (rows[0].quantity > 0) await logMovement(client, rows[0], rows[0].quantity, "Initial stock");
      return rows[0];
    });
    res.status(201).json(created);
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: `"${item.name}" already exists.` });
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  const { errors, item } = validateItem(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: errors.join(" ") });
  try {
    const updated = await inTransaction(async (client) => {
      const { rows: existing } = await client.query("SELECT quantity FROM inventory_items WHERE id = $1 FOR UPDATE", [id]);
      if (existing.length === 0) return null;
      const { rows } = await client.query(
        `UPDATE inventory_items SET name = $1, category = $2, color = $3, unit = $4, quantity = $5,
           reorder_level = $6, unit_cost = $7, notes = $8, image = $9, updated_at = now()
         WHERE id = $10 RETURNING *`,
        [item.name, item.category, item.color, item.unit, item.quantity, item.reorder_level, item.unit_cost, item.notes, item.image, id]
      );
      const change = rows[0].quantity - existing[0].quantity;
      if (change !== 0) await logMovement(client, rows[0], change, "Stock count corrected");
      return rows[0];
    });
    if (!updated) return res.status(404).json({ error: "Item not found." });
    res.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: `"${item.name}" already exists.` });
    next(err);
  }
});

// Adds or removes stock (e.g. +20 delivered, -3 used). Refuses to go
// below zero rather than silently clamping.
router.post("/:id/adjust", async (req, res, next) => {
  const id = Number(req.params.id);
  const change = Number(req.body?.change);
  const reason = String(req.body?.reason ?? "").trim();
  if (!Number.isInteger(change) || change === 0) {
    return res.status(400).json({ error: "Change must be a whole number other than 0." });
  }
  try {
    const result = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE inventory_items SET quantity = quantity + $1, updated_at = now()
         WHERE id = $2 AND quantity + $1 >= 0 RETURNING *`,
        [change, id]
      );
      if (rows.length === 0) return null;
      await logMovement(client, rows[0], change, reason || (change > 0 ? "Stock added" : "Stock used"));
      return rows[0];
    });
    if (!result) {
      const { rows } = await pool.query("SELECT quantity FROM inventory_items WHERE id = $1", [id]);
      if (rows.length === 0) return res.status(404).json({ error: "Item not found." });
      return res.status(400).json({ error: `Only ${rows[0].quantity} in stock — can't remove ${-change}.` });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM inventory_items WHERE id = $1", [Number(req.params.id)]);
    if (rowCount === 0) return res.status(404).json({ error: "Item not found." });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
