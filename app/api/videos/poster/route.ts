import { NextRequest } from "next/server";
import { posterProxyTarget } from "@/lib/video/poster";

/**
 * Same-origin poster proxy.
 *
 * Every catalog card asks this route for its picture rather than the CDN
 * directly, which is what keeps thumbnails visible when a visitor runs an ad
 * blocker (the adult CDNs are on the block lists), when a CDN hotlink-protects
 * a path against a foreign referer, or when the stored value is fine but the
 * browser's network is not.
 *
 * Safety rules, in order:
 *
 *  * only `https` URLs on an allowlisted poster CDN are fetched — the endpoint
 *    cannot be pointed at an arbitrary host and cannot become an open proxy;
 *  * only a path that ends in an image extension is accepted;
 *  * the answer must be `image/*`, so an HTML error page is never echoed back;
 *  * the body is capped, so one oversized file cannot exhaust a function;
 *  * the result is cached for a year (immutable), so a poster is fetched once.
 *
 * A miss answers 404 with a short cache, which makes the card fall back to the
 * CDN URL and then to the erobabe mark.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Posters are ~20–120 kB; anything past this is not a thumbnail. */
const MAX_BYTES = 6 * 1024 * 1024;

/** Only the headers are on this clock; the body of a 120 kB image is instant. */
const UPSTREAM_TIMEOUT_MS = 10_000;

const MISS_HEADERS = { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" };
const HIT_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800, immutable",
  "X-Content-Type-Options": "nosniff",
  "Content-Disposition": "inline",
};

function miss(): Response {
  return new Response("Not found", { status: 404, headers: MISS_HEADERS });
}

/** The referer the media host expects, so a hotlink-protected path still answers. */
function refererFor(): string {
  return "https://www.damplips.com/";
}

export async function GET(request: NextRequest) {
  const target = posterProxyTarget(request.nextUrl.searchParams.get("src"));
  if (!target) return miss();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "user-agent": USER_AGENT,
        referer: refererFor(),
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
      },
      // A redirect that lands off the allowlist is refused below.
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });

    if (!upstream.ok) return miss();

    // `fetch` follows redirects, so the final URL is what has to be re-checked.
    if (posterProxyTarget(upstream.url) == null) return miss();

    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return miss();

    const declared = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return miss();

    const body = await upstream.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_BYTES) return miss();

    return new Response(body, {
      status: 200,
      headers: {
        ...HIT_HEADERS,
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
      },
    });
  } catch {
    return miss();
  } finally {
    clearTimeout(timer);
  }
}
