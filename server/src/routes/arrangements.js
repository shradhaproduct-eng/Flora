import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

function computeTotals({ items, materials_cost, markup_multiplier }) {
  const stems_cost = items.reduce((sum, item) => sum + item.stem_price * item.stems, 0);
  const total_cost = stems_cost + materials_cost;
  const selling_price = total_cost * markup_multiplier;
  const profit = selling_price - total_cost;
  return { stems_cost, total_cost, selling_price, profit };
}

function validatePayload(body) {
  const errors = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.push("Arrangement name is required.");

  const items = Array.isArray(body.items) ? body.items : [];
  const cleanItems = [];
  for (const raw of items) {
    const stems = Number(raw.stems);
    if (!raw.flower_name || !Number.isFinite(stems) || stems <= 0) continue;
    cleanItems.push({
      flower_id: raw.flower_id ?? null,
      flower_name: String(raw.flower_name).trim(),
      stem_price: Number(raw.stem_price) || 0,
      stems,
      line_total: (Number(raw.stem_price) || 0) * stems,
    });
  }
  if (cleanItems.length === 0) errors.push("Add at least one flower with a stem count.");

  const materials_cost = Number(body.materials_cost);
  if (!Number.isFinite(materials_cost) || materials_cost < 0) {
    errors.push("Materials & extras cost must be a non-negative number.");
  }

  const markup_multiplier = Number(body.markup_multiplier);
  if (!Number.isFinite(markup_multiplier) || markup_multiplier < 0) {
    errors.push("Markup multiplier must be a non-negative number.");
  }

  return { errors, name, items: cleanItems, materials_cost, markup_multiplier };
}

async function insertItems(client, arrangementId, items) {
  for (const item of items) {
    await client.query(
      `INSERT INTO arrangement_items (arrangement_id, flower_id, flower_name, stem_price, stems, line_total)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [arrangementId, item.flower_id, item.flower_name, item.stem_price, item.stems, item.line_total]
    );
  }
}

async function fetchItems(client, arrangementId) {
  const { rows } = await client.query(
    "SELECT * FROM arrangement_items WHERE arrangement_id = $1 ORDER BY id ASC",
    [arrangementId]
  );
  return rows;
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM arrangements ORDER BY updated_at DESC, id DESC"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const { rows } = await pool.query("SELECT * FROM arrangements WHERE id = $1", [id]);
    const arrangement = rows[0];
    if (!arrangement) return res.status(404).json({ error: "Arrangement not found." });
    const items = await fetchItems(pool, id);
    res.json({ ...arrangement, items });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  const { errors, name, items, materials_cost, markup_multiplier } = validatePayload(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: errors.join(" ") });
  const totals = computeTotals({ items, materials_cost, markup_multiplier });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO arrangements
         (name, materials_cost, markup_multiplier, stems_cost, total_cost, selling_price, profit, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING *`,
      [
        name,
        materials_cost,
        markup_multiplier,
        totals.stems_cost,
        totals.total_cost,
        totals.selling_price,
        totals.profit,
      ]
    );
    const arrangement = rows[0];
    await insertItems(client, arrangement.id, items);
    await client.query("COMMIT");

    const savedItems = await fetchItems(client, arrangement.id);
    res.status(201).json({ ...arrangement, items: savedItems });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

router.put("/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    const { rows: existingRows } = await client.query("SELECT id FROM arrangements WHERE id = $1", [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: "Arrangement not found." });
    }

    const { errors, name, items, materials_cost, markup_multiplier } = validatePayload(req.body || {});
    if (errors.length > 0) return res.status(400).json({ error: errors.join(" ") });
    const totals = computeTotals({ items, materials_cost, markup_multiplier });

    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE arrangements SET
         name = $1, materials_cost = $2, markup_multiplier = $3,
         stems_cost = $4, total_cost = $5, selling_price = $6, profit = $7, updated_at = now()
       WHERE id = $8
       RETURNING *`,
      [
        name,
        materials_cost,
        markup_multiplier,
        totals.stems_cost,
        totals.total_cost,
        totals.selling_price,
        totals.profit,
        id,
      ]
    );
    await client.query("DELETE FROM arrangement_items WHERE arrangement_id = $1", [id]);
    await insertItems(client, id, items);
    await client.query("COMMIT");

    const savedItems = await fetchItems(client, id);
    res.json({ ...rows[0], items: savedItems });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const { rowCount } = await pool.query("DELETE FROM arrangements WHERE id = $1", [id]);
    if (rowCount === 0) return res.status(404).json({ error: "Arrangement not found." });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
