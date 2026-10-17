import "dotenv/config";
import { createApp } from "./app.js";
import { BRAND, PLATFORM } from "./brand.js";

const PORT = process.env.PORT || 4000;

createApp().listen(PORT, () => {
  console.log(`${PLATFORM.name} API (${BRAND.name}) listening on http://localhost:${PORT}`);
});
