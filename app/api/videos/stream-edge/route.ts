import { NextRequest } from "next/server";
import { isDamplipsMediaUrl } from "@/lib/video/playback";

/**
 * Same-origin playback proxy for damplips media, on the **edge** runtime.
 *
 * The Node function cannot fetch this host at all. Cloudflare — which fronts
 * `video.damplips.com` — answers every request from it with a managed challenge
 * ("Just a moment..."), whatever the user-agent, client hints, TLS cipher order,
 * HTTP version or referer. That is a per-egress decision, not a per-request
 * one, so no header can change it.
 *
 * Vercel's edge network is a different egress and it is not challenged: the same
 * file answers `206 video/mp4` with a correct `content-range` in about a second.
 * Media therefore streams through here, and the visitor never has to reach
 * damplips themselves — which is what fixes playback for a visitor whose own
 * network refuses the media host.
 *
 * Only damplips hosts are served (no tokens, no foreign hosts): this route is
 * not an open proxy, and everything it is allowed to fetch is also listed in
 * `next.config.mjs`'s image allow-list.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Headers that make the request look like the browser damplips expects. */
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const UPSTREAM_PROFILES: Record<string, string>[] = [
  {
    "user-agent": CHROME_UA,
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-dest": "video",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "same-origin",
    referer: "https://www.damplips.com/",
    origin: "https://www.damplips.com",
  },
  {
    "user-agent": CHROME_UA,
    accept: "*/*",
    referer: "https://www.damplips.com/",
  },
  {
    "user-agent": CHROME_UA,
    accept: "*/*",
  },
];

const GENERIC_TYPES = new Set([
  "application/octet-stream",
  "application/force-download",
  "application/x-download",
  "binary/octet-stream",
  "",
]);

/** Media is immutable enough to cache hard at the CDN. */
const MEDIA_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

/** Response headers worth passing through untouched. */
const PASS_THROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

function badRequest(message: string, status = 400, block?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  };
  if (block) headers["x-media-block"] = block;
  return new Response(message, { status, headers });
}

/** A media URL answered with a document is a block page, not the file. */
function looksBlocked(target: URL, upstream: Response): boolean {
  const type = (upstream.headers.get("content-type") || "").toLowerCase();
  return upstream.ok && type.includes("text/html") && /\.[a-z0-9]+$/i.test(target.pathname);
}

function contentTypeFor(path: string, upstreamType: string | null): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  const raw = (upstreamType || "").split(";")[0].trim().toLowerCase();
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (raw && !GENERIC_TYPES.has(raw) && !raw.includes("text/html")) return upstreamType;
  return upstreamType;
}

function isUsableMedia(upstream: Response, target: URL): boolean {
  if (looksBlocked(target, upstream)) return false;
  // 304 is cheap for browsers with a cache, but a <video> element handed an
  // empty 304 has nothing to decode — that is MEDIA_ERR_SRC_NOT_SUPPORTED.
  return upstream.status === 206 || upstream.status === 200;
}

const RANGE_REJECTED = new Set([400, 403, 416, 501]);

async function handle(req: NextRequest, headOnly: boolean): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("src");
  if (!raw) return badRequest("A src parameter is required");

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return badRequest("src must be an absolute URL");
  }
  if (target.protocol !== "https:" || target.username || target.password) {
    return badRequest("src must be a public https URL", 403);
  }
  if (!isDamplipsMediaUrl(target.toString())) {
    return badRequest("Only damplips media can be streamed here", 403);
  }

  const range = req.headers.get("range");
  const bounded = Number(req.nextUrl.searchParams.get("len"));
  const extra: Record<string, string> = {};
  if (range) extra.range = range;
  else if (Number.isFinite(bounded) && bounded > 0) {
    extra.range = `bytes=0-${Math.min(bounded, 4_000_000) - 1}`;
  }
  // Validators are not forwarded: a 304 with no body is unplayable.

  const extrasToTry: Record<string, string>[] = [extra];
  if (extra.range) {
    const { range: _range, ...withoutRange } = extra;
    extrasToTry.push(withoutRange);
  }

  let upstream: Response | null = null;
  try {
    for (const extraHeaders of extrasToTry) {
      for (const profile of UPSTREAM_PROFILES) {
        const headers = { ...profile, ...extraHeaders };
        const attempt = await fetch(target, { headers, redirect: "follow", cache: "no-store" });
        if (isUsableMedia(attempt, target)) {
          upstream = attempt;
          break;
        }
        void attempt.body?.cancel().catch(() => undefined);
        upstream = attempt;
        if (extraHeaders.range && RANGE_REJECTED.has(attempt.status)) break;
      }
      if (upstream && isUsableMedia(upstream, target)) break;
    }
  } catch {
    return badRequest("The media host could not be reached", 502, "unreachable");
  }
  if (!upstream) {
    return badRequest("The media host could not be reached", 502, "unreachable");
  }

  const isMediaPath = /\.[a-z0-9]+$/i.test(target.pathname);

  // `?probe=1` answers with what the host said instead of streaming, so the
  // route can be checked from anywhere without downloading a film. `&len=N`
  // additionally reads N bytes through the stream, which is how the route is
  // verified end to end without pulling a 120 MB file.
  if (req.nextUrl.searchParams.get("probe") === "1") {
    const summary = {
      ok: upstream.ok,
      status: upstream.status,
      contentType: upstream.headers.get("content-type"),
      contentLength: upstream.headers.get("content-length"),
      contentRange: upstream.headers.get("content-range"),
      acceptRanges: upstream.headers.get("accept-ranges"),
      blocked: looksBlocked(target, upstream),
    };
    const wanted = Number(req.nextUrl.searchParams.get("len"));
    let streamed: number | undefined;
    if (Number.isFinite(wanted) && wanted > 0) {
      const reader = upstream.body?.getReader();
      let read = 0;
      const limit = Math.min(wanted, 4_000_000);
      while (reader && read < limit) {
        const chunk = await reader.read();
        if (chunk.done) break;
        read += chunk.value?.byteLength ?? 0;
      }
      void reader?.cancel().catch(() => undefined);
      streamed = read;
    } else {
      void upstream.body?.cancel().catch(() => undefined);
    }
    return Response.json(
      streamed === undefined ? summary : { ...summary, streamed },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (!upstream.ok) {
    void upstream.body?.cancel().catch(() => undefined);
    return badRequest(`The media host responded ${upstream.status}`, 502, "host-refused");
  }

  if (looksBlocked(target, upstream)) {
    void upstream.body?.cancel().catch(() => undefined);
    return badRequest(
      "The media host answered with a page instead of the file.",
      502,
      "challenge",
    );
  }

  const responseHeaders = new Headers();
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // The element needs to know it can seek, and a host that omits the header
  // still serves ranges.
  if (upstream.status === 206 && !responseHeaders.has("accept-ranges")) {
    responseHeaders.set("accept-ranges", "bytes");
  }
  responseHeaders.set("cache-control", MEDIA_CACHE_CONTROL);
  responseHeaders.set("x-content-type-options", "nosniff");
  const mediaType = contentTypeFor(target.pathname, responseHeaders.get("content-type"));
  if (mediaType) responseHeaders.set("content-type", mediaType);
  else if (isMediaPath) responseHeaders.set("content-type", "video/mp4");
  if (!responseHeaders.has("accept-ranges")) responseHeaders.set("accept-ranges", "bytes");

  return new Response(headOnly ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req, false);
}

export async function HEAD(req: NextRequest): Promise<Response> {
  return handle(req, true);
}
