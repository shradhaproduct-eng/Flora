import pg from "pg";

const { Pool } = pg;

// Lazily constructed on first use rather than at module import time. A
// serverless function that throws synchronously while its module is still
// being evaluated (as this did before, when no connection string was set)
// often surfaces to the client as a bare 404 instead of a 500 -- Vercel's
// router can't resolve a function that never finished loading, so the
// underlying error never reaches anyone. Deferring this into a getter means
// a misconfigured env var instead fails inside a request, where it's caught
// by app.js's error handler and returned as a normal JSON 500.
let _pool = null;

function getPool() {
  if (_pool) return _pool;

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

  _pool = new Pool({
    connectionString,
    // Hosted providers (Neon, Vercel Postgres, Supabase, Render) require TLS
    // and use certs that Node's default trust store won't validate; local
    // Postgres has no sslmode in its connection string, so this stays off.
    ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : false,
  });
  return _pool;
}

// A Proxy so existing call sites (`pool.query(...)`, `pool.connect()`) keep
// working unchanged, while the real Pool -- and its connection-string check
// -- is only created the first time something is actually called on it.
export const pool = new Proxy(
  {},
  {
    get(_target, prop) {
      const real = getPool();
      const value = real[prop];
      return typeof value === "function" ? value.bind(real) : value;
    },
  }
);

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
    // Reemflora public price catalogue (AED, per stem unless noted),
    // compiled 2026-08-24 from https://reemflora.com/collections/new-products
    // and https://reemflora.com/collections/greeneries. Prices can change
    // with stock/season -- re-upload a refreshed CSV via Flower Catalog &
    // Settings to update them; this list only seeds a brand-new database.
    const starter = [
      ['Allium Light Purple', 14.0],
      ['Anthurium Dyed', 32.0],
      ['Areca Palm (per bunch)', 45.0],
      ['Areca Palm Rainbow', 5.5],
      ['Aster Purple', 6.5],
      ['Astilbe Pink', 8.5],
      ['Brassica Purple', 15.5],
      ['Calla Lily Pink', 16.0],
      ['Calla Lily White', 16.0],
      ['Carnation Dark Pink', 4.5],
      ['Carnation Dark Purple', 4.5],
      ['Carnation Kiwi', 6.5],
      ['Carnation Painted Blue Lagoon', 8.5],
      ['Carnation Peach', 4.4],
      ['Carnation Pink', 6.5],
      ['Carnation Pink Montezuma', 6.5],
      ['Carnation Red', 6.5],
      ['Carnation Single Painted Cote D\'Azur', 6.5],
      ['Carnation White', 4.5],
      ['Celosia Green', 14.0],
      ['Celosia Pink', 14.5],
      ['Chasmanthium Latifolium', 4.5],
      ['China Grass Variegated (per bunch)', 22.0],
      ['Chrysanthemum Bubblegum (Big Head)', 16.0],
      ['Chrysanthemum Button Green', 6.5],
      ['Chrysanthemum Button White', 6.5],
      ['Chrysanthemum Deco Big Head Pink', 8.5],
      ['Chrysanthemum Deco White', 8.5],
      ['Chrysanthemum Pina Colada', 4.5],
      ['Chrysanthemum Purple', 4.5],
      ['Chrysanthemum Rabello Red', 4.5],
      ['Chrysanthemum Red Chianti', 4.5],
      ['Chrysanthemum Santini Adore', 6.5],
      ['Chrysanthemum Santini Daisy Yellow', 6.5],
      ['Chrysanthemum Santini Doria Purple', 6.5],
      ['Chrysanthemum Santini Light Pink', 6.5],
      ['Chrysanthemum Santini Miller Orange', 6.5],
      ['Chrysanthemum Santini Peptalk', 6.5],
      ['Chrysanthemum Santini Salmon', 6.5],
      ['Chrysanthemum Santini Yellow', 6.5],
      ['Chrysanthemum Santini Ying Yang Lilac', 6.5],
      ['Chrysanthemum Santini Ying Yang Yellow', 6.5],
      ['Chrysanthemum Single Painted Antonov Blue Lagoon', 16.0],
      ['Chrysanthemum Single Painted Antonov Green', 16.0],
      ['Chrysanthemum Single Painted Antonov Navy Jumbo', 14.0],
      ['Chrysanthemum Single Painted Purple', 8.0],
      ['Chrysanthemum Single Vip Decor Navy Jumbo', 14.0],
      ['Chrysanthemum Sprays Pina Colada Yellow', 4.5],
      ['Chrysanthemum Sprays Pink', 6.5],
      ['Chrysanthemum Veronica Pink', 4.5],
      ['Craspedia Dyed Green', 5.5],
      ['Craspedia Dyed Purple', 5.5],
      ['Craspedia Dyed Red', 5.5],
      ['Craspedia Globosa', 4.5],
      ['Eucalyptus Cinerea', 9.5],
      ['Eucalyptus Cinerea Dyed Blue', 9.5],
      ['Eucalyptus Painted', 10.5],
      ['Eucalyptus Parvifolia', 9.5],
      ['Geraldton Wax Pink', 4.5],
      ['Geraldton Wax Purple', 4.5],
      ['Gerbera Bizar', 6.5],
      ['Gerbera Caramba', 7.5],
      ['Gerbera Flamazing', 6.5],
      ['Gerbera Mini Anna', 7.5],
      ['Gerbera Mini Juna', 5.5],
      ['Gerbera Mini Opus', 5.5],
      ['Gerbera Mini Oreo', 7.5],
      ['Gerbera Mini Pacman', 5.5],
      ['Gerbera Mini Purple Wonder', 6.5],
      ['Gerbera Mini Talent', 6.5],
      ['Gerbera Mini White', 7.5],
      ['Gerbera Pasta Rosata', 12.0],
      ['Gerbera White', 6.5],
      ['Gladiolus Hot Pink', 15.5],
      ['Grevillia Ivanhoe', 6.5],
      ['Gypsophila Babys-Breath', 5.8],
      ['Gypsophila Mirabella', 5.8],
      ['Hydrangea White', 18.0],
      ['King Protea Cynaroides', 55.0],
      ['Leucospermum Orange', 13.99],
      ['Lily Oriental Marengo', 16.0],
      ['Limonium Shooting Star', 6.5],
      ['Limonium Sinense Anouchka Diamond', 6.5],
      ['Limonium Skylight', 6.5],
      ['Lisianthus Double Antica', 7.5],
      ['Lisianthus Double Sabrina Orange', 7.5],
      ['Lisianthus Green', 8.99],
      ['Lisianthus Hot Pink', 13.5],
      ['Lisianthus Pink', 12.5],
      ['Matthiola Lavender', 5.5],
      ['Matthiola White', 5.5],
      ['Oriental Lily Colet', 16.0],
      ['Oriental Lily White', 16.0],
      ['Ornithogalum Arabicum Saundersiae', 5.5],
      ['Ornithogalum Thyrsoides Mount Fuji', 5.5],
      ['Pampass Natural', 9.0],
      ['Panicum Fontaine', 5.5],
      ['Rose Deep Purple', 2.99],
      ['Rose Esperance', 3.99],
      ['Rose Jumilia', 2.99],
      ['Rose Light Pink', 2.99],
      ['Rose Light Purple', 2.49],
      ['Rose Orange', 2.99],
      ['Rose Peach', 2.99],
      ['Rose Pink', 2.99],
      ['Rose Senorita', 2.99],
      ['Rose Sunny Confidential', 2.99],
      ['Rose White', 2.99],
      ['Ruscus', 1.99],
      ['Rustic Sunflower Head', 11.0],
      ['Salix Willows', 12.0],
      ['Sanguisorba Officinalis', 12.5],
      ['Setaria Green', 5.5],
      ['Silver Brunia Stem', 6.5],
      ['Spray Rose Eileen', 5.5],
      ['Spray Rose Fireworks', 5.5],
      ['Spray Rose Fuchsia', 4.5],
      ['Spray Rose Odilia', 5.5],
      ['Spray Rose Red', 5.5],
      ['Spray Rose Scented Peach', 5.5],
      ['Spray Rose White', 5.5],
      ['Spray Rose Yellow Babe', 5.5],
      ['Strelitzia Reginae Leaf', 8.5],
      ['Tulip Pink', 6.5],
      ['Tulip Yellow', 7.5],
      ['Veronica Skyler Blue', 4.5],
    ];
    const values = [];
    const placeholders = starter.map(([name, price], i) => {
      values.push(name, price);
      return `($${i * 2 + 1}, $${i * 2 + 2})`;
    });
    await pool.query(
      `INSERT INTO flowers (name, stem_price) VALUES ${placeholders.join(", ")}
       ON CONFLICT (name) DO NOTHING`,
      values
    );
  }
}
