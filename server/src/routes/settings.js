import { Router } from "express";
import { db } from "../db.js";

const router = Router();

function readSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return {
    default_materials_cost: Number(settings.default_materials_cost ?? 0),
    default_markup_multiplier: Number(settings.default_markup_multiplier ?? 1),
  };
}

router.get("/", (req, res) => {
  res.json(readSettings());
});

router.put("/", (req, res) => {
  const { default_materials_cost, default_markup_multiplier } = req.body || {};
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );

  if (default_materials_cost !== undefined) {
    const val = Number(default_materials_cost);
    if (!Number.isFinite(val) || val < 0) {
      return res.status(400).json({ error: "Default materials/extras cost must be a non-negative number." });
    }
    upsert.run("default_materials_cost", String(val));
  }
  if (default_markup_multiplier !== undefined) {
    const val = Number(default_markup_multiplier);
    if (!Number.isFinite(val) || val < 0) {
      return res.status(400).json({ error: "Default markup multiplier must be a non-negative number." });
    }
    upsert.run("default_markup_multiplier", String(val));
  }

  res.json(readSettings());
});

export default router;
