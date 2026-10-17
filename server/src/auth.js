import crypto from "node:crypto";
import { promisify } from "node:util";
import { Router } from "express";
import { pool } from "./db.js";

// Single-user login. The username, a scrypt hash of the password and a
// random session-signing secret live in the settings table (seeded by the
// migration in db.js). A session is a signed, HTTP-only cookie — no session
// table — so it works the same across serverless instances.

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = "bb_session";
const SESSION_DAYS = 30;

export const DEFAULT_USERNAME = "buttercup admin";
export const DEFAULT_PASSWORD = "Buttercup123";

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [salt, hashHex] = String(stored).split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

async function readAuthSettings() {
  const { rows } = await pool.query(
    "SELECT key, value FROM settings WHERE key IN ('admin_username', 'admin_password_hash', 'session_secret')"
  );
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { username: s.admin_username, passwordHash: s.admin_password_hash, secret: s.session_secret };
}

// The signing key includes the password hash, so changing the password
// signs out every existing session.
function sign(payload, auth) {
  return crypto
    .createHmac("sha256", `${auth.secret}:${auth.passwordHash}`)
    .update(payload)
    .digest("base64url");
}

function createToken(auth) {
  const payload = Buffer.from(
    JSON.stringify({ u: auth.username, exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 })
  ).toString("base64url");
  return `${payload}.${sign(payload, auth)}`;
}

function verifyToken(token, auth) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload, auth);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.u !== auth.username || !(data.exp > Date.now())) return null;
    return data;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`
  );
}

// Guards every /api route except the ones the login screen itself needs.
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login", "/api/auth/logout"]);

export async function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.originalUrl.split("?")[0])) return next();
  try {
    const auth = await readAuthSettings();
    const session = verifyToken(readCookie(req, COOKIE_NAME), auth);
    if (!session) return res.status(401).json({ error: "Please sign in." });
    req.user = { username: session.u };
    next();
  } catch (err) {
    next(err);
  }
}

export const authRouter = Router();

authRouter.post("/login", async (req, res, next) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  try {
    const auth = await readAuthSettings();
    const ok =
      username.toLowerCase() === String(auth.username).toLowerCase() &&
      (await verifyPassword(password, auth.passwordHash));
    if (!ok) {
      // Small fixed delay to slow down password guessing.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    setSessionCookie(req, res, createToken(auth), SESSION_DAYS * 24 * 60 * 60);
    res.json({ username: auth.username });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res) => {
  setSessionCookie(req, res, "", 0);
  res.status(204).end();
});

authRouter.get("/me", (req, res) => {
  res.json({ username: req.user.username });
});

authRouter.put("/credentials", async (req, res, next) => {
  const currentPassword = String(req.body?.current_password ?? "");
  const newUsername = String(req.body?.new_username ?? "").trim();
  const newPassword = String(req.body?.new_password ?? "");
  try {
    const auth = await readAuthSettings();
    if (!(await verifyPassword(currentPassword, auth.passwordHash))) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
    if (!newUsername) return res.status(400).json({ error: "Username can't be empty." });
    if (newPassword && newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const passwordHash = newPassword ? await hashPassword(newPassword) : auth.passwordHash;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('admin_username', $1), ('admin_password_hash', $2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [newUsername, passwordHash]
    );
    // Re-issue this browser's cookie so the person making the change stays
    // signed in; any other sessions are invalidated by the new hash.
    const updated = { ...auth, username: newUsername, passwordHash };
    setSessionCookie(req, res, createToken(updated), SESSION_DAYS * 24 * 60 * 60);
    res.json({ username: newUsername });
  } catch (err) {
    next(err);
  }
});
