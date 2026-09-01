import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

async function readSettings() {
  const { rows } = await pool.query("SELECT key, value FROM settings");
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return {
    default_materials_cost: Number(settings.default_materials_cost ?? 0),
    default_markup_multiplier: Number(settings.default_markup_multiplier ?? 1),
  };
}

async function upsertSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

router.get("/", async (req, res, next) => {
  try {
    res.json(await readSettings());
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req, res, next) => {
  const { default_materials_cost, default_markup_multiplier } = req.body || {};
  try {
    if (default_materials_cost !== undefined) {
      const val = Number(default_materials_cost);
      if (!Number.isFinite(val) || val < 0) {
        return res
          .status(400)
          .json({ error: "Default materials/extras cost must be a non-negative number." });
      }
      await upsertSetting("default_materials_cost", String(val));
    }
    if (default_markup_multiplier !== undefined) {
      const val = Number(default_markup_multiplier);
      if (!Number.isFinite(val) || val < 0) {
        return res.status(400).json({ error: "Default markup multiplier must be a non-negative number." });
      }
      await upsertSetting("default_markup_multiplier", String(val));
    }
    res.json(await readSettings());
  } catch (err) {
    next(err);
  }
});

export default router;
