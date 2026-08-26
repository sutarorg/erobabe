import crypto from "node:crypto";

/* ──────────────────────────────────────────────────────────────
 * Shared server utilities: env, HTTP, cookies, sessions,
 * scrypt password hashing, in-memory rate limiting, ids.
 * Zero external dependencies — runs on Vercel & Netlify Node 18+.
 * ────────────────────────────────────────────────────────────── */

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const ENV = (key, fallback = undefined) => process.env[key] ?? fallback;

/** Returns the list of missing required environment variables. */
export function missingEnv(keys) {
  return keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
}

/* ── HTTP helpers ── */

export function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export const badRequest = (msg = "Invalid request") => new HttpError(400, msg, "bad_request");
export const unauthorized = (msg = "Authentication required") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "Not allowed") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Not found") => new HttpError(404, msg, "not_found");

export async function readJson(req) {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}

export function toError(e) {
  if (e instanceof HttpError) return e;
  return new HttpError(500, "Internal server error", "internal");
}

/* ── Cookies ── */

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, { maxAgeSec = 0, secure = true, httpOnly = true, sameSite = "Lax", path = "/" } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSec}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/* ── Sessions (HMAC-signed token, HttpOnly cookie) ── */

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function createSessionToken(username, secret, ttlSec = 60 * 60 * 12) {
  const payload = {
    sub: username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    jti: crypto.randomBytes(8).toString("hex"),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token, secret) {
  if (!token || !secret || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (!timingSafeStr(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ── Password hashing (scrypt, format: N$r$p$saltB64$hashB64) ── */

export function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, { N, r, p });
  return `${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [N, r, p, saltB64, hashB64] = String(stored).split("$");
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ── In-memory sliding-window rate limiter (best-effort on serverless) ── */

const buckets = new Map();
let sweepAt = 0;

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  if (now > sweepAt) {
    sweepAt = now + windowMs;
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  const b = buckets.get(key) ?? { count: 0, reset: now + windowMs };
  if (b.reset < now) {
    b.count = 0;
    b.reset = now + windowMs;
  }
  b.count += 1;
  buckets.set(key, b);
  const ok = b.count <= limit;
  return { ok, retryAfterSec: ok ? 0 : Math.ceil((b.reset - now) / 1000) };
}

/* ── Misc ── */

export function clientIp(headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "anonymous"
  );
}

export const sha256hex = (str) => crypto.createHash("sha256").update(str).digest("hex");

export function timingSafeStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export const uuid = () => crypto.randomUUID();

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

/** Enforce a simple CSRF header on mutating requests. */
export function assertCsrf(req) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  if (req.headers.get("x-requested-with") !== "erobabe") {
    throw forbidden("Missing request header (CSRF protection)");
  }
}
