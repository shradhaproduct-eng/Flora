import { Router } from "express";
import { db } from "../db.js";

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

router.get("/", (req, res) => {
  const arrangements = db
    .prepare("SELECT * FROM arrangements ORDER BY updated_at DESC, id DESC")
    .all();
  res.json(arrangements);
});

router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const arrangement = db.prepare("SELECT * FROM arrangements WHERE id = ?").get(id);
  if (!arrangement) return res.status(404).json({ error: "Arrangement not found." });
  const items = db
    .prepare("SELECT * FROM arrangement_items WHERE arrangement_id = ? ORDER BY id ASC")
    .all(id);
  res.json({ ...arrangement, items });
});

router.post("/", (req, res) => {
  const { errors, name, items, materials_cost, markup_multiplier } = validatePayload(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: errors.join(" ") });

  const totals = computeTotals({ items, materials_cost, markup_multiplier });

  const insertArrangement = db.prepare(`
    INSERT INTO arrangements
      (name, materials_cost, markup_multiplier, stems_cost, total_cost, selling_price, profit, updated_at)
    VALUES (@name, @materials_cost, @markup_multiplier, @stems_cost, @total_cost, @selling_price, @profit, datetime('now'))
  `);
  const insertItem = db.prepare(`
    INSERT INTO arrangement_items (arrangement_id, flower_id, flower_name, stem_price, stems, line_total)
    VALUES (@arrangement_id, @flower_id, @flower_name, @stem_price, @stems, @line_total)
  `);

  const arrangementId = db.transaction(() => {
    const info = insertArrangement.run({ name, materials_cost, markup_multiplier, ...totals });
    const id = info.lastInsertRowid;
    for (const item of items) insertItem.run({ arrangement_id: id, ...item });
    return id;
  })();

  const saved = db.prepare("SELECT * FROM arrangements WHERE id = ?").get(arrangementId);
  const savedItems = db
    .prepare("SELECT * FROM arrangement_items WHERE arrangement_id = ? ORDER BY id ASC")
    .all(arrangementId);
  res.status(201).json({ ...saved, items: savedItems });
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM arrangements WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Arrangement not found." });

  const { errors, name, items, materials_cost, markup_multiplier } = validatePayload(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: errors.join(" ") });

  const totals = computeTotals({ items, materials_cost, markup_multiplier });

  const updateArrangement = db.prepare(`
    UPDATE arrangements SET
      name = @name, materials_cost = @materials_cost, markup_multiplier = @markup_multiplier,
      stems_cost = @stems_cost, total_cost = @total_cost, selling_price = @selling_price,
      profit = @profit, updated_at = datetime('now')
    WHERE id = @id
  `);
  const insertItem = db.prepare(`
    INSERT INTO arrangement_items (arrangement_id, flower_id, flower_name, stem_price, stems, line_total)
    VALUES (@arrangement_id, @flower_id, @flower_name, @stem_price, @stems, @line_total)
  `);

  db.transaction(() => {
    updateArrangement.run({ id, name, materials_cost, markup_multiplier, ...totals });
    db.prepare("DELETE FROM arrangement_items WHERE arrangement_id = ?").run(id);
    for (const item of items) insertItem.run({ arrangement_id: id, ...item });
  })();

  const saved = db.prepare("SELECT * FROM arrangements WHERE id = ?").get(id);
  const savedItems = db
    .prepare("SELECT * FROM arrangement_items WHERE arrangement_id = ? ORDER BY id ASC")
    .all(id);
  res.json({ ...saved, items: savedItems });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM arrangements WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "Arrangement not found." });
  res.status(204).end();
});

export default router;
