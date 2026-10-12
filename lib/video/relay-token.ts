/**
 * Signed tokens for the streaming upload relay (server-only).
 *
 * The relay is a standalone Node process (never Next.js/Vercel — request-body
 * limits make proxying video bytes through a function impossible). It has no
 * database and no Streamtape credentials: the Next.js server mints a token
 * that carries the provider's upload URL, and the relay verifies the HMAC
 * before streaming the browser's multipart body to that URL.
 *
 * Token format (kept trivially simple so `relay/streamtape-relay.mjs` can
 * verify it with nothing but `node:crypto`):
 *
 *   v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(payload))>
 *
 * Payload: `{ u: <upload URL>, s: <session id>, exp: <epoch ms> }`
 *
 * Secrets: `STREAMTAPE_RELAY_SECRET` must be identical in the app and the
 * relay, must never be a NEXT_PUBLIC_* variable, and must never be logged.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const RELAY_TOKEN_VERSION = "v1";

/** Hard ceiling on token lifetime even if the provider's `valid_until` is longer. */
export const RELAY_TOKEN_MAX_TTL_MS = 3 * 60 * 60 * 1000;

export interface RelayTokenPayload {
  /** Provider upload URL (already host-validated by the caller). */
  u: string;
  /** Upload session id (`upload_jobs.provider_upload_id`). */
  s: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

export class RelayTokenError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RelayTokenError";
    this.code = code;
  }
}

function b64urlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function b64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(rawPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(rawPayload).digest("base64url");
}

export function signRelayToken(payload: RelayTokenPayload, secret: string): string {
  if (!secret || secret.length < 16) {
    throw new RelayTokenError("STREAMTAPE_RELAY_SECRET must be set to a random string of at least 16 characters", "weak_secret");
  }
  if (!payload?.u || !payload?.s || !Number.isFinite(payload?.exp)) {
    throw new RelayTokenError("Relay token payload is incomplete", "bad_payload");
  }
  const rawPayload = b64urlEncode(JSON.stringify(payload));
  return `${RELAY_TOKEN_VERSION}.${rawPayload}.${signPayload(rawPayload, secret)}`;
}

/**
 * Verifies signature + expiry. Throws `RelayTokenError` on anything invalid —
 * the relay answers 403 without leaking why beyond a short code.
 */
export function verifyRelayToken(token: string, secret: string, now: number = Date.now()): RelayTokenPayload {
  if (!token || typeof token !== "string") throw new RelayTokenError("Missing upload token", "malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== RELAY_TOKEN_VERSION) throw new RelayTokenError("Unsupported upload token", "malformed");

  const [, rawPayload, signature] = parts;
  if (!rawPayload || !signature) throw new RelayTokenError("Malformed upload token", "malformed");
  if (!secret) throw new RelayTokenError("Relay secret is not configured", "no_secret");

  const expected = signPayload(rawPayload, secret);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw new RelayTokenError("Upload token signature does not match", "bad_signature");
  }

  let payload: RelayTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(rawPayload)) as RelayTokenPayload;
  } catch {
    throw new RelayTokenError("Upload token payload is not valid JSON", "malformed");
  }

  if (!payload || typeof payload.u !== "string" || typeof payload.s !== "string" || !Number.isFinite(payload.exp)) {
    throw new RelayTokenError("Upload token payload is incomplete", "malformed");
  }
  if (payload.exp <= now) throw new RelayTokenError("Upload token has expired — start a new upload", "expired");
  if (payload.exp - now > RELAY_TOKEN_MAX_TTL_MS + 60_000) {
    throw new RelayTokenError("Upload token lifetime is longer than allowed", "bad_payload");
  }
  return payload;
}
