import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const isUniqueViolation = (err) => err.code === "23505";

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM flowers ORDER BY lower(name) ASC");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  const { name, stem_price } = req.body || {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const price = Number(stem_price);
  if (!trimmedName) return res.status(400).json({ error: "Flower name is required." });
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: "Stem price must be a non-negative number." });
  }
  try {
    const { rows } = await pool.query(
      "INSERT INTO flowers (name, stem_price, updated_at) VALUES ($1, $2, now()) RETURNING *",
      [trimmedName, price]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: `A flower named "${trimmedName}" already exists.` });
    }
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const { rows: existingRows } = await pool.query("SELECT * FROM flowers WHERE id = $1", [id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: "Flower not found." });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    const price =
      req.body?.stem_price !== undefined ? Number(req.body.stem_price) : existing.stem_price;

    if (!name) return res.status(400).json({ error: "Flower name is required." });
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "Stem price must be a non-negative number." });
    }

    const { rows } = await pool.query(
      "UPDATE flowers SET name = $1, stem_price = $2, updated_at = now() WHERE id = $3 RETURNING *",
      [name, price, id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: `A flower named "${req.body?.name}" already exists.` });
    }
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const { rowCount } = await pool.query("DELETE FROM flowers WHERE id = $1", [id]);
    if (rowCount === 0) return res.status(404).json({ error: "Flower not found." });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// One-time (or repeatable) bulk CSV upload: columns `name,stem_price`.
// Upserts by flower name so re-uploading a refreshed price list is safe.
router.post("/upload-csv", upload.single("file"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "No CSV file uploaded." });

  const text = req.file.buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return res.status(400).json({ error: "CSV file is empty." });

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const priceIdx = header.findIndex((h) => h === "stem_price" || h === "price");
  const useHeader = nameIdx !== -1 && priceIdx !== -1;
  const dataLines = useHeader ? lines.slice(1) : lines;
  const nIdx = useHeader ? nameIdx : 0;
  const pIdx = useHeader ? priceIdx : 1;

  const errors = [];
  let imported = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [idx, line] of dataLines.entries()) {
      const cols = line.split(",");
      const name = (cols[nIdx] || "").trim();
      const price = Number((cols[pIdx] || "").trim());
      if (!name || !Number.isFinite(price) || price < 0) {
        errors.push(`Row ${idx + (useHeader ? 2 : 1)}: "${line}" skipped (invalid name/price).`);
        continue;
      }
      await client.query(
        `INSERT INTO flowers (name, stem_price, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (name) DO UPDATE SET stem_price = excluded.stem_price, updated_at = now()`,
        [name, price]
      );
      imported += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    return next(err);
  }
  client.release();

  try {
    const { rows: flowers } = await pool.query("SELECT * FROM flowers ORDER BY lower(name) ASC");
    res.json({ imported, errors, flowers });
  } catch (err) {
    next(err);
  }
});

export default router;
