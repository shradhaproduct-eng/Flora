# 🌸 Flora — Flower Cost Calculator

A full-stack app for building flower arrangements, costing them out, and
saving the combinations you like. Deploys as a single Vercel project.

- **Backend:** Express app, run as a Vercel serverless function in
  production (`api/[...path].js` → `server/src/app.js`) or as a normal
  Node process locally (`server/src/index.js`).
- **Database:** Postgres (works with Vercel Postgres/Neon, or any other
  Postgres host).
- **Frontend:** React + Vite — `client/`, built to static files Vercel
  serves directly.

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
  Postgres.
- One-time (or repeatable) **CSV bulk upload** for the flower catalog —
  upload a `name,stem_price` CSV and it upserts by name. See
  `sample-flowers.csv` for the format.

## Project layout

This is an npm workspaces monorepo (root `package.json` lists `client` and
`server` as workspaces) so a single `npm install` at the repo root installs
both.

```
api/[...path].js     Vercel serverless entry point (catch-all for /api/*)
server/src/app.js    Express app (routes, middleware) — shared by both entry points
server/src/index.js  Local dev entry point (Node http server via app.listen)
server/src/db.js     Postgres pool + schema/seed migration
client/               React + Vite frontend
vercel.json           Vercel build config
```

## Local development

Requires Node.js 18+ and a Postgres database (local, Docker, or a
Neon/Vercel Postgres dev branch — any Postgres works).

```bash
# 1. Install everything (root workspaces install client + server deps)
npm install

# 2. Point the API at a Postgres database
cp server/.env.example server/.env
# edit server/.env if your database isn't at the default local URL

# 3. Start the API (http://localhost:4000)
npm run dev:server

# 4. In a second terminal, start the frontend (http://localhost:5173)
npm run dev:client
```

Open http://localhost:5173. The Vite dev server proxies `/api` requests to
the backend on port 4000. On first request, the API auto-creates its
tables and seeds a starter flower catalog plus default global settings
(materials/extras cost = $5.00, markup multiplier = 2.5×) — both editable
from the **Flower Catalog & Settings** tab.

**No local Postgres handy?** Run one in Docker:
```bash
docker run --name flora-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=flora -p 5432:5432 -d postgres:16
```
That matches the default `DATABASE_URL` in `server/.env.example`.

## Deploying to Vercel

1. Push this repo to GitHub (already done) and import it into Vercel as a
   new project — the root `vercel.json` configures the build
   (`npm run build`, output `client/dist`) and Vercel auto-detects
   `api/[...path].js` as a serverless function.
2. Add a Postgres database: in the Vercel project's **Storage** tab,
   create a Postgres store (backed by Neon) and connect it to the
   project. This sets the `POSTGRES_URL` environment variable
   automatically — `server/src/db.js` picks it up with no extra config.
   (Using a different Postgres host instead? Set `DATABASE_URL` in the
   project's Environment Variables instead.)
3. Deploy. The first request to any `/api/*` route runs the schema/seed
   migration automatically, same as local dev.

No `vercel dev`/CLI required — pushing to the connected GitHub branch (or
clicking Deploy) is enough once the Postgres storage is connected.

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
