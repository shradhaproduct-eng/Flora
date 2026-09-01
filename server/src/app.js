import express from "express";
import cors from "cors";
import { ensureSchema } from "./db.js";
import flowersRouter from "./routes/flowers.js";
import settingsRouter from "./routes/settings.js";
import arrangementsRouter from "./routes/arrangements.js";

// Builds the Express app without starting a listener, so it can be reused
// both by the local dev server (server/src/index.js, via app.listen) and
// by the Vercel serverless function (api/[...path].js, which calls the app
// directly as a (req, res) handler).
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Cheap no-op after the first request on a given (local or warm
  // serverless) process; runs the CREATE TABLE / seed migration on demand
  // instead of at import time, since import-time top-level await doesn't
  // play well with how Vercel bundles functions.
  app.use((req, res, next) => {
    ensureSchema().then(() => next(), next);
  });

  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.use("/api/flowers", flowersRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/arrangements", arrangementsRouter);

  // Generic error handler so unexpected exceptions return JSON, not HTML.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}
