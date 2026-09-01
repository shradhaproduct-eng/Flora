import { Router } from "express";
import multer from "multer";
import { db } from "../db.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.get("/", (req, res) => {
  const flowers = db
    .prepare("SELECT * FROM flowers ORDER BY name COLLATE NOCASE ASC")
    .all();
  res.json(flowers);
});

router.post("/", (req, res) => {
  const { name, stem_price } = req.body || {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const price = Number(stem_price);
  if (!trimmedName) return res.status(400).json({ error: "Flower name is required." });
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: "Stem price must be a non-negative number." });
  }
  try {
    const info = db
      .prepare(
        "INSERT INTO flowers (name, stem_price, updated_at) VALUES (?, ?, datetime('now'))"
      )
      .run(trimmedName, price);
    const flower = db.prepare("SELECT * FROM flowers WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(flower);
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: `A flower named "${trimmedName}" already exists.` });
    }
    res.status(500).json({ error: "Failed to create flower." });
  }
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM flowers WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Flower not found." });

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const price =
    req.body?.stem_price !== undefined ? Number(req.body.stem_price) : existing.stem_price;

  if (!name) return res.status(400).json({ error: "Flower name is required." });
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: "Stem price must be a non-negative number." });
  }

  try {
    db.prepare(
      "UPDATE flowers SET name = ?, stem_price = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(name, price, id);
    res.json(db.prepare("SELECT * FROM flowers WHERE id = ?").get(id));
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: `A flower named "${name}" already exists.` });
    }
    res.status(500).json({ error: "Failed to update flower." });
  }
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM flowers WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "Flower not found." });
  res.status(204).end();
});

// One-time (or repeatable) bulk CSV upload: columns `name,stem_price`.
// Upserts by flower name so re-uploading a refreshed price list is safe.
router.post("/upload-csv", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No CSV file uploaded." });

  const text = req.file.buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return res.status(400).json({ error: "CSV file is empty." });

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const priceIdx = header.findIndex((h) => h === "stem_price" || h === "price");
  const dataLines = nameIdx === -1 || priceIdx === -1 ? lines : lines.slice(1);
  const useHeader = nameIdx !== -1 && priceIdx !== -1;
  const nIdx = useHeader ? nameIdx : 0;
  const pIdx = useHeader ? priceIdx : 1;

  const upsert = db.prepare(`
    INSERT INTO flowers (name, stem_price, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET stem_price = excluded.stem_price, updated_at = datetime('now')
  `);

  const errors = [];
  let imported = 0;

  const run = db.transaction((rows) => {
    rows.forEach((line, idx) => {
      const cols = line.split(",");
      const name = (cols[nIdx] || "").trim();
      const price = Number((cols[pIdx] || "").trim());
      if (!name || !Number.isFinite(price) || price < 0) {
        errors.push(`Row ${idx + (useHeader ? 2 : 1)}: "${line}" skipped (invalid name/price).`);
        return;
      }
      upsert.run(name, price);
      imported += 1;
    });
  });
  run(dataLines);

  const flowers = db.prepare("SELECT * FROM flowers ORDER BY name COLLATE NOCASE ASC").all();
  res.json({ imported, errors, flowers });
});

export default router;
