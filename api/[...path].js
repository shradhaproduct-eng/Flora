// Vercel serverless entry point. The bracketed catch-all filename maps
// every request under /api/* to this one function, and Vercel forwards the
// full original path (e.g. /api/flowers) — so the Express app underneath
// can keep routing exactly as it does for local dev (server/src/index.js),
// no adapter needed: an Express app is itself a valid (req, res) handler.
import { createApp } from "../server/src/app.js";

const app = createApp();

export default app;
