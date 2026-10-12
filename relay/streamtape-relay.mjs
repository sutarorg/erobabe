/**
 * Streamtape streaming upload relay — standalone Node ≥18 process.
 *
 * WHY THIS EXISTS
 * - The video bytes must never pass through Next.js/Vercel (4.5 MB request
 *   body limit), and CORS on Streamtape's upload node is not documented or
 *   proven (see docs/STREAMTAPE_MIGRATION.md §3.1). The browser therefore
 *   POSTs multipart/form-data here — same-origin or with an explicit CORS
 *   grant — and this process pipes it straight to the node URL the app
 *   minted into the upload token.
 *
 * SECURITY MODEL
 * - It holds NO Streamtape credentials. The only capability it accepts is a
 *   token minted by the Next.js app:  v1.<base64url(payload)>.<hmac-sha256>
 *   payload = { u: <https upload URL>, s: <session id>, exp: <epoch ms> }
 *   verified with STREAMTAPE_RELAY_SECRET (shared secret, ≥16 chars).
 * - One-shot: a session id is accepted once (in-memory LRU). Multi-instance
 *   deployments need a shared store — run ONE relay instance per deployment
 *   or adapt `makeUsedTracker` to Redis etc.
 * - SSRF defence in depth: even though the URL is signed by the app, the
 *   host must still match the provider allowlist.
 * - No body buffering: the incoming request stream is piped to `fetch(…,
 *   duplex: 'half')` and the node's response is piped back verbatim.
 *
 * ENVIRONMENT
 *   STREAMTAPE_RELAY_SECRET            required, ≥16 chars, shared with the app
 *   STREAMTAPE_RELAY_ALLOWED_ORIGINS   comma list, e.g. https://erobabe.com
 *   STREAMTAPE_UPLOAD_HOST_SUFFIXES    optional extra upload-node suffixes
 *   RELAY_PORT                         explicit port; falls back to PORT, then 8787
 *   RELAY_MAX_UPLOAD_BYTES             optional cap, default 15 GiB
 *
 * RUN
 *   node relay/streamtape-relay.mjs
 *
 * Tests import the pure helpers below — nothing here is mocked away.
 */

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

export const RELAY_TOKEN_VERSION = "v1";
export const DEFAULT_UPLOAD_HOST_SUFFIXES = ["tapecontent.net", "streamtape.com"];
export const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024 * 1024;
export const IDLE_TIMEOUT_MS = 120_000;

const PLACEHOLDER_RELAY_SECRET =
  /^(?:generate[_-]a[_-]long[_-]random[_-]string|your(?:[_-].*)?|example(?:[_-].*)?|placeholder(?:[_-].*)?|change[_-]?me|replace[_-]?me|password(?:[_-].*)?|test(?:[_-].*)?)$/i;

/** The relay refuses example values even when they happen to exceed 16 chars. */
export function isValidRelaySecret(secret) {
  const value = String(secret || "").trim();
  return value.length >= 16 && !PLACEHOLDER_RELAY_SECRET.test(value) && !/^(.)\1+$/.test(value);
}

// ---------------------------------------------------------------------- tokens

export class RelayTokenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RelayTokenError";
    this.code = code;
  }
}

function signPayload(rawPayload, secret) {
  return createHmac("sha256", secret).update(rawPayload).digest("base64url");
}

/** Same wire format as `lib/video/relay-token.ts` in the app. */
export function verifyRelayToken(token, secret, now = Date.now()) {
  if (!token || typeof token !== "string") throw new RelayTokenError("Missing upload token", "malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== RELAY_TOKEN_VERSION) throw new RelayTokenError("Unsupported upload token", "malformed");
  const [, rawPayload, signature] = parts;
  if (!rawPayload || !signature) throw new RelayTokenError("Malformed upload token", "malformed");
  if (!secret) throw new RelayTokenError("Relay secret is not configured", "no_secret");

  const expected = Buffer.from(signPayload(rawPayload, secret));
  const provided = Buffer.from(signature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new RelayTokenError("Upload token signature does not match", "bad_signature");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(rawPayload, "base64url").toString("utf8"));
  } catch {
    throw new RelayTokenError("Upload token payload is not valid JSON", "malformed");
  }
  if (!payload || typeof payload.u !== "string" || typeof payload.s !== "string" || !Number.isFinite(payload.exp)) {
    throw new RelayTokenError("Upload token payload is incomplete", "malformed");
  }
  if (payload.exp <= now) throw new RelayTokenError("Upload token has expired", "expired");
  return payload;
}

// ------------------------------------------------------------------ SSRF guard

export function isAllowedUploadHost(value, extraSuffixes = []) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  const suffixes = [...DEFAULT_UPLOAD_HOST_SUFFIXES, ...extraSuffixes]
    .map((suffix) => String(suffix || "").trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Bounded single-use cache for session ids (one relay instance). */
export function makeUsedTracker(max = 1000) {
  const seen = new Set();
  return {
    /** Returns true when this is the first use of `id`. */
    claim(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > max) {
        // Drop the oldest insertion — Set preserves insertion order.
        const oldest = seen.values().next().value;
        seen.delete(oldest);
      }
      return true;
    },
    has(id) {
      return seen.has(id);
    },
    size() {
      return seen.size;
    },
  };
}

// --------------------------------------------------------------------- server

function corsHeaders(req, allowedOrigins) {
  const origin = req.headers.origin;
  const list = allowedOrigins;
  const allowed =
    !origin
      ? null
      : list.includes("*")
        ? "*"
        : list.find((entry) => entry.toLowerCase() === String(origin).toLowerCase());
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": allowed,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

/**
 * Creates the relay HTTP server.
 *
 * @param {{ secret: string, allowedOrigins: string[], extraHostSuffixes?: string[],
 *           maxUploadBytes?: number, now?: () => number, logger?: (...args:any[])=>void }} options
 */
export function createRelay(options) {
  const secret = options.secret;
  const allowedOrigins = options.allowedOrigins || [];
  const extraHostSuffixes = options.extraHostSuffixes || [];
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const now = options.now || (() => Date.now());
  const log = options.logger || (() => {});
  const used = options.usedTracker || makeUsedTracker();

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://relay.local");
    const cors = corsHeaders(req, allowedOrigins);

    if (req.method === "OPTIONS") {
      if (Object.keys(cors).length) {
        res.writeHead(204, cors);
        res.end();
      } else {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: 403, msg: "Origin not allowed", result: null }));
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: 200, msg: "OK", result: { ok: true } }, cors);
      return;
    }

    const match = url.pathname.match(/^\/upload\/(.+)$/);
    if (req.method !== "POST" || !match) {
      sendJson(res, 404, { status: 404, msg: "Not found", result: null }, cors);
      return;
    }

    if (Object.keys(cors).length === 0 && req.headers.origin) {
      // A cross-origin POST without a granted origin would fail in the browser
      // anyway; refuse server-side too instead of proxying uselessly.
      sendJson(res, 403, { status: 403, msg: "Origin not allowed", result: null }, cors);
      return;
    }

    if (maxUploadBytes > 0 && Number(req.headers["content-length"]) > maxUploadBytes) {
      sendJson(res, 413, { status: 413, msg: "Upload exceeds the relay's size cap", result: null }, cors);
      return;
    }

    let payload;
    try {
      payload = verifyRelayToken(match[1], secret, now());
    } catch (error) {
      sendJson(res, error instanceof RelayTokenError && error.code === "expired" ? 410 : 403, {
        status: error instanceof RelayTokenError && error.code === "expired" ? 410 : 403,
        msg: error instanceof Error ? error.message : "Invalid upload token",
        result: null,
      }, cors);
      return;
    }

    if (!isAllowedUploadHost(payload.u, extraHostSuffixes)) {
      sendJson(res, 400, { status: 400, msg: "Upload token points at a disallowed host", result: null }, cors);
      return;
    }

    if (!used.claim(payload.s)) {
      sendJson(res, 409, { status: 409, msg: "Upload session already used — request a new one", result: null }, cors);
      return;
    }

    // ---- stream browser → node ------------------------------------------------
    const controller = new AbortController();
    let idleTimer = null;
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };
    touch();

    req.on("data", touch);
    res.on("close", () => {
      if (!res.writableEnded) controller.abort(); // client went away → abort upstream
    });

    const contentType = req.headers["content-type"] || "multipart/form-data";
    fetch(payload.u, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: Readable.toWeb(req),
      duplex: "half",
      signal: controller.signal,
      redirect: "follow",
    })
      .then(async (upstream) => {
        touch();
        const text = await upstream.text().catch(() => "");
        if (idleTimer) clearTimeout(idleTimer);
        const headers = {
          "Content-Type": upstream.headers.get("content-type") || "application/json",
          "Cache-Control": "no-store",
          ...cors,
        };
        res.writeHead(upstream.status, headers);
        res.end(text);
        log("upload", { session: payload.s, status: upstream.status });
      })
      .catch((error) => {
        if (idleTimer) clearTimeout(idleTimer);
        if (res.writableEnded || res.destroyed) return;
        const aborted = error?.name === "AbortError" || controller.signal.aborted;
        sendJson(res, aborted ? 499 : 502, {
          status: aborted ? 499 : 502,
          msg: aborted ? "Upload cancelled before it finished" : "The relay could not reach the Streamtape upload node",
          result: null,
        }, cors);
        log("upload-error", { session: payload.s, aborted });
      });
  });

  return server;
}

// ----------------------------------------------------------------------- main

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  const secret = (process.env.STREAMTAPE_RELAY_SECRET || "").trim();
  if (!isValidRelaySecret(secret)) {
    console.error("[relay] Set STREAMTAPE_RELAY_SECRET to a unique random string of at least 16 characters; do not use the .env.example placeholder.");
    process.exit(1);
  }
  // Most container platforms supply PORT automatically; RELAY_PORT overrides it.
  const port = Number(process.env.RELAY_PORT || process.env.PORT || 8787);
  const server = createRelay({
    secret,
    allowedOrigins: parseList(process.env.STREAMTAPE_RELAY_ALLOWED_ORIGINS),
    extraHostSuffixes: parseList(process.env.STREAMTAPE_UPLOAD_HOST_SUFFIXES),
    maxUploadBytes: Number(process.env.RELAY_MAX_UPLOAD_BYTES || DEFAULT_MAX_UPLOAD_BYTES),
    logger: (...args) => console.log("[relay]", ...args),
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[relay] listening on 0.0.0.0:${port} (POST /upload/{token}, GET /health)`);
  });
}
