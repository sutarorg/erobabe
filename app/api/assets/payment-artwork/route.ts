import { NextResponse } from "next/server";
import { PAYMENT_PANEL_IMAGE_URL } from "@/lib/ads/payment";

/**
 * The checkout artwork, served from our own origin.
 *
 * The panel used to point a `<img>` straight at the image host. That host is a
 * one-shot public file host: it answers from a single region, sends no
 * long-lived cache headers, and a 2560 × 1440 PNG is over a megabyte before the
 * browser has painted anything — which is why the right-hand panel sat empty
 * for seconds on a first visit (and on every visit after it, once the response
 * was not cacheable).
 *
 * This route fetches that file **once**, re-encodes it to a smaller AVIF/WebP
 * (sharp, which Next already ships for image optimisation), keeps the result in
 * memory, and serves it `immutable` from the edge. Browsers therefore get a
 * same-origin, ~10× smaller file with no cold DNS/TLS to a third party, and the
 * operator can override the source with
 * `NEXT_PUBLIC_PAYMENT_PANEL_IMAGE_URL` without touching this code.
 *
 * If anything fails — no network, an unsupported format, no sharp — the route
 * redirects to the original URL rather than showing a broken panel, and the
 * redirect itself is cached briefly so a brief outage is retried soon.
 */

export const runtime = "nodejs";

const MAX_WIDTH_DESKTOP = 1400;
/** The panel is never wider than a phone screen, so 2× that is plenty. */
const MAX_WIDTH_MOBILE = 900;
const FETCH_TIMEOUT_MS = 6000;
const UPSTREAM_TTL_MS = 24 * 60 * 60 * 1000;

type Cached = { body: Buffer; contentType: string; at: number };

const cache = new Map<string, Cached>();

function redirectToSource() {
  return NextResponse.redirect(PAYMENT_PANEL_IMAGE_URL, {
    status: 302,
    headers: {
      // Short enough that recovering from a transient outage needs no deploy,
      // long enough that a burst of visitors does not hammer the host.
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}

export async function GET(request: Request) {
  const width = new URL(request.url).searchParams.get("w") === "mobile"
    ? MAX_WIDTH_MOBILE
    : MAX_WIDTH_DESKTOP;
  const key = `${PAYMENT_PANEL_IMAGE_URL}#${width}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < UPSTREAM_TTL_MS) {
    return new NextResponse(new Uint8Array(hit.body), {
      headers: {
        "Content-Type": hit.contentType,
        "Content-Length": String(hit.body.length),
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(PAYMENT_PANEL_IMAGE_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "image/png,image/jpeg,image/webp,image/avif,image/*" },
    });
    if (!upstream.ok) return redirectToSource();
    const original = Buffer.from(await upstream.arrayBuffer());
    if (!original.length) return redirectToSource();

    // `sharp` is optional here: without it the untouched bytes still beat a
    // third-party origin, because they are cacheable and same-origin.
    let body = original;
    let contentType = upstream.headers.get("content-type") || "image/png";
    try {
      const { default: sharp } = await import("sharp");
      const image = sharp(original, { failOn: "none" });
      const meta = await image.metadata();
      if (!meta.width || meta.width <= width) {
        // Already small enough: re-encode without upscaling.
        body = await image.avif({ quality: 62 }).toBuffer();
      } else {
        body = await image.resize({ width, withoutEnlargement: true }).avif({ quality: 62 }).toBuffer();
      }
      contentType = "image/avif";
    } catch {
      /* Keep the original bytes when the encoder is unavailable. */
    }

    cache.set(key, { body, contentType, at: Date.now() });
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.length),
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return redirectToSource();
  } finally {
    clearTimeout(timer);
  }
}
