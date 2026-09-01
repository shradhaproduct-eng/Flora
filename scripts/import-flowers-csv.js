#!/usr/bin/env node
// One-off script to push a flowers CSV straight into a Postgres database --
// the same upsert-by-name logic as the app's own Upload CSV button
// (server/src/routes/flowers.js), but run directly against a database
// instead of through the web UI. Useful for a fresh Neon/production
// database where you'd rather not click through the app once it's live.
//
// Usage:
//   DATABASE_URL="postgres://...neon.tech/...?sslmode=require" \
//     node scripts/import-flowers-csv.js [path/to/file.csv]
//
// CSV path defaults to data/reemflora-flowers-greeneries.csv (this repo's
// own bundled catalogue) if omitted. The CSV needs a `name,stem_price`
// header (or two bare columns in that order with no header).
//
// Safe to re-run: upserts by flower name, so running it again (e.g. after
// refreshing the price sheet) just updates prices rather than duplicating
// rows.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const csvPath = process.argv[2] || path.join(__dirname, "..", "data", "reemflora-flowers-greeneries.csv");

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "No connection string found. Set DATABASE_URL (or POSTGRES_URL) to your Neon connection " +
      "string before running this script, e.g.:\n\n" +
      '  DATABASE_URL="postgres://user:pass@host/db?sslmode=require" node scripts/import-flowers-csv.js\n'
  );
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`CSV file not found: ${csvPath}`);
  process.exit(1);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const priceIdx = header.findIndex((h) => h === "stem_price" || h === "price");
  const useHeader = nameIdx !== -1 && priceIdx !== -1;
  const dataLines = useHeader ? lines.slice(1) : lines;
  const nIdx = useHeader ? nameIdx : 0;
  const pIdx = useHeader ? priceIdx : 1;

  const rows = [];
  const errors = [];
  dataLines.forEach((line, idx) => {
    const cols = line.split(",");
    const name = (cols[nIdx] || "").trim();
    const price = Number((cols[pIdx] || "").trim());
    if (!name || !Number.isFinite(price) || price < 0) {
      errors.push(`Row ${idx + (useHeader ? 2 : 1)}: "${line}" skipped (invalid name/price).`);
      return;
    }
    rows.push([name, price]);
  });
  return { rows, errors };
}

async function main() {
  const text = fs.readFileSync(csvPath, "utf-8");
  const { rows, errors } = parseCsv(text);

  if (errors.length > 0) {
    console.warn(`${errors.length} row(s) skipped:`);
    for (const e of errors) console.warn(`  ${e}`);
  }
  if (rows.length === 0) {
    console.error("No valid rows to import.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : false,
  });

  console.log(`Connecting and ensuring schema exists...`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      stem_price DOUBLE PRECISION NOT NULL CHECK (stem_price >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log(`Upserting ${rows.length} flower(s) from ${path.relative(process.cwd(), csvPath)}...`);
  const client = await pool.connect();
  let imported = 0;
  try {
    await client.query("BEGIN");
    for (const [name, price] of rows) {
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
    throw err;
  } finally {
    client.release();
  }

  const { rows: countRows } = await pool.query("SELECT COUNT(*)::int AS c FROM flowers");
  console.log(`Done. Upserted ${imported} row(s). Table now has ${countRows[0].c} flower(s) total.`);

  await pool.end();
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
