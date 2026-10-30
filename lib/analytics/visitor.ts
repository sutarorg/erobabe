import { createHmac } from "node:crypto";
import { RequestError } from "@/lib/http/safety";

/**
 * The pseudonymous visitor key used to count unique visitors.
 *
 * Unlike the ad-event/rate-limit hash in `lib/http/safety` — which includes the
 * UTC date and therefore forgets a visitor overnight — this one is stable for
 * as long as the same network + browser pair shows up, so "unique visitors"
 * over a 7- or 28-day range is a real distinct count instead of the sum of
 * daily uniques.
 *
 * The raw IP and the user-agent are hashed with HMAC-SHA256 and never stored.
 * Changing `ANALYTICS_HASH_SECRET` rotates every key at once (the history stays
 * coherent, it simply stops joining to older keys).
 */
function analyticsSecret(): string {
  const secret =
    process.env.ANALYTICS_HASH_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new RequestError("Service unavailable", 503);
  return secret;
}

/** Stable 64-hex visitor key for a request. */
export function analyticsVisitorHash(req: Request): string {
  const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";
  const agent = (req.headers.get("user-agent") || "").slice(0, 256);
  return createHmac("sha256", analyticsSecret())
    .update(`analytics:${ip}:${agent}`)
    .digest("hex");
}

/** Deployment host, used to drop self-referrals. */
export function requestSiteHost(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).hostname;
    } catch {
      /* fall through to the host header */
    }
  }
  const host = req.headers.get("host");
  if (!host) return null;
  return host.split(":")[0].toLowerCase();
}
