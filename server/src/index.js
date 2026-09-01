import express from "express";
import cors from "cors";
import "./db.js";
import flowersRouter from "./routes/flowers.js";
import settingsRouter from "./routes/settings.js";
import arrangementsRouter from "./routes/arrangements.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/flowers", flowersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/arrangements", arrangementsRouter);

// Generic error handler so unexpected exceptions return JSON, not HTML.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`Flora API listening on http://localhost:${PORT}`);
});
