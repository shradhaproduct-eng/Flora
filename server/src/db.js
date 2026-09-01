import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FLORA_DB_PATH || path.join(__dirname, "..", "flora.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS flowers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    stem_price REAL NOT NULL CHECK (stem_price >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS arrangements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    materials_cost REAL NOT NULL DEFAULT 0,
    markup_multiplier REAL NOT NULL DEFAULT 1,
    stems_cost REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    selling_price REAL NOT NULL DEFAULT 0,
    profit REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS arrangement_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    arrangement_id INTEGER NOT NULL REFERENCES arrangements(id) ON DELETE CASCADE,
    flower_id INTEGER REFERENCES flowers(id) ON DELETE SET NULL,
    flower_name TEXT NOT NULL,
    stem_price REAL NOT NULL,
    stems INTEGER NOT NULL CHECK (stems >= 0),
    line_total REAL NOT NULL
  );
`);

// Seed default global settings (materials/extras cost + markup multiplier)
// used as "universal constants" that pre-fill every new arrangement and can
// be overridden per-arrangement without changing the global default.
const defaultSettings = {
  default_materials_cost: "5.00",
  default_markup_multiplier: "2.5",
};

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
);
for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, value);
}

// Seed a small starter flower catalog so the app isn't empty before the
// one-time CSV upload happens.
const flowerCount = db.prepare("SELECT COUNT(*) AS c FROM flowers").get().c;
if (flowerCount === 0) {
  const insertFlower = db.prepare(
    "INSERT OR IGNORE INTO flowers (name, stem_price) VALUES (?, ?)"
  );
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
  const insertMany = db.transaction((rows) => {
    for (const [name, price] of rows) insertFlower.run(name, price);
  });
  insertMany(starter);
}
