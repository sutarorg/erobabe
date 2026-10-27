/**
 * Short-lived proof that a media URL was discovered by this server.
 *
 * The stream proxy may only start a request for damplips media. An HLS
 * playlist, however, names its segments, keys and nested renditions with URIs
 * that frequently live on a damplips media CDN rather than on damplips.com. A
 * browser that fetched those directly would be stopped by CORS or by hotlink
 * protection, and the player would report "the video could not be loaded" even
 * though every byte is playable.
 *
 * So the playlist rewriter proxies *every* URI it emits, and stamps the ones
 * that are not on a damplips host with a signature over that exact URL. The
 * route accepts a foreign host only when it presents a valid, unexpired
 * signature, which keeps the endpoint closed as an open proxy while letting a
 * real playlist play end to end.
 *
 * This module is server-only: it signs with `node:crypto`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Long enough for a feature-length stream, short enough to stop being useful. */
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * The signing key. A dedicated secret is preferred; the Supabase service key is
 * already present on every deployment, and a per-site fallback keeps local
 * development working. Without a configured secret the signature still binds a
 * URL to this deployment — it simply stops being unforgeable, which grants no
 * privilege the public-https and no-private-host rules do not already allow.
 */
function secret(): string {
  const configured =
    process.env.MEDIA_PROXY_SECRET ||
    process.env.ANALYTICS_HASH_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (configured) return `erobabe-media:${configured}`;
  return `erobabe-media:${process.env.NEXT_PUBLIC_SITE_URL || "local"}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** `"<expiry>.<signature>"` for one absolute URL. */
export function signMediaUrl(url: string, now = Date.now()): string {
  const expires = Math.floor((now + TTL_MS) / 1000);
  return `${expires}.${sign(`${expires}\n${url}`)}`;
}

/** True when `token` was minted for exactly this URL and has not expired. */
export function verifyMediaToken(
  url: string,
  token: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{16,86})$/.exec(token);
  if (!match) return false;
  const expiresAt = Number(match[1]) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = Buffer.from(sign(`${match[1]}\n${url}`), "utf8");
  const given = Buffer.from(match[2], "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
