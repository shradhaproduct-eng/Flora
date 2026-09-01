import pg from "pg";

const { Pool } = pg;

// Vercel's Postgres storage (Neon-backed) sets POSTGRES_URL; a plain
// DATABASE_URL works for any other Postgres host (local dev, Railway,
// Supabase, etc).
const connectionString =
  process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL;

if (!connectionString) {
  throw new Error(
    "No Postgres connection string found. Set POSTGRES_URL or DATABASE_URL in your environment " +
      "(see .env.example)."
  );
}

export const pool = new Pool({
  connectionString,
  // Hosted providers (Neon, Vercel Postgres, Supabase, Render) require TLS
  // and use certs that Node's default trust store won't validate; local
  // Postgres has no sslmode in its connection string, so this stays off.
  ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : false,
});

// Runs once per warm serverless instance (or once at local startup) and is
// otherwise a cheap no-op, so it's safe to call from request middleware.
let migrated = null;
export function ensureSchema() {
  if (!migrated) migrated = runMigration();
  return migrated;
}

async function runMigration() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      stem_price DOUBLE PRECISION NOT NULL CHECK (stem_price >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS arrangements (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      materials_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      markup_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1,
      stems_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      selling_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      profit DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS arrangement_items (
      id SERIAL PRIMARY KEY,
      arrangement_id INTEGER NOT NULL REFERENCES arrangements(id) ON DELETE CASCADE,
      flower_id INTEGER REFERENCES flowers(id) ON DELETE SET NULL,
      flower_name TEXT NOT NULL,
      stem_price DOUBLE PRECISION NOT NULL,
      stems INTEGER NOT NULL CHECK (stems >= 0),
      line_total DOUBLE PRECISION NOT NULL
    );
  `);

  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('default_materials_cost', '5.00')
     ON CONFLICT (key) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('default_markup_multiplier', '2.5')
     ON CONFLICT (key) DO NOTHING`
  );

  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM flowers");
  if (rows[0].c === 0) {
    const starter = [
      ["Rose", 2.5],
      ["Tulip", 1.75],
      ["Lily", 3.0],
      ["Carnation", 1.25],
      ["Peony", 4.5],
      ["Hydrangea", 5.0],
      ["Baby's Breath", 1.0],
      ["Sunflower", 2.25],
    ];
    for (const [name, price] of starter) {
      await pool.query(
        "INSERT INTO flowers (name, stem_price) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
        [name, price]
      );
    }
  }
}
