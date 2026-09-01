# 🌸 Flora — Flower Cost Calculator

A full-stack app for building flower arrangements, costing them out, and
saving the combinations you like.

- **Backend:** Node.js + Express + SQLite (`better-sqlite3`) — `server/`
- **Frontend:** React + Vite — `client/`

## What it does

- Pick flowers from a catalog and set stems per flower — cost updates live.
- A separate **materials & extras** cost and a **markup multiplier** are
  kept as global defaults ("universal constants"). Every new arrangement
  is pre-filled with them, and either one can be overridden per
  arrangement without touching the global default.
- Shows stems cost, total cost, **potential selling price**
  (`total cost × markup multiplier`) and **profit** (`selling price − total cost`)
  as you build.
- Each arrangement gets a friendly default name auto-generated from the
  flowers you picked (e.g. "Rose & Tulip Bouquet"), which you can type
  over or reset back to the auto-generated version with **Clear**.
- Save, edit, and delete arrangement combinations — they persist in
  SQLite.
- One-time (or repeatable) **CSV bulk upload** for the flower catalog —
  upload a `name,stem_price` CSV and it upserts by name. See
  `sample-flowers.csv` for the format.

## Getting started

Requires Node.js 18+.

```bash
# 1. Install and start the API (http://localhost:4000)
cd server
npm install
npm start

# 2. In a second terminal, install and start the frontend (http://localhost:5173)
cd client
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` requests to
the backend on port 4000.

The SQLite database is created automatically at `server/flora.db` on first
run, seeded with a small starter flower catalog and default global settings
(materials/extras cost = $5.00, markup multiplier = 2.5×). Both are
editable from the **Flower Catalog & Settings** tab.

## Production build

```bash
cd client && npm run build   # outputs client/dist
cd ../server && npm start    # API only; serve client/dist with any static host/reverse proxy in front of it
```

## API overview

| Method | Path                        | Purpose                                   |
| ------ | --------------------------- | ------------------------------------------ |
| GET    | `/api/flowers`               | List flower catalog                       |
| POST   | `/api/flowers`               | Add a flower                               |
| PUT    | `/api/flowers/:id`           | Update a flower's name/price               |
| DELETE | `/api/flowers/:id`           | Remove a flower                            |
| POST   | `/api/flowers/upload-csv`    | Bulk upsert flowers from a CSV file         |
| GET    | `/api/settings`              | Read global defaults                       |
| PUT    | `/api/settings`              | Update global defaults                     |
| GET    | `/api/arrangements`          | List saved arrangements                    |
| GET    | `/api/arrangements/:id`      | Get one arrangement with its line items     |
| POST   | `/api/arrangements`          | Save a new arrangement                     |
| PUT    | `/api/arrangements/:id`      | Update a saved arrangement                 |
| DELETE | `/api/arrangements/:id`      | Delete a saved arrangement                 |
