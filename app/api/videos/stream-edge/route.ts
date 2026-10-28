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
const UPSTREAM_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="126", "Not:A-Brand";v="24", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "video",
  "sec-fetch-mode": "no-cors",
  "sec-fetch-site": "same-origin",
  "upgrade-insecure-requests": "1",
  referer: "https://www.damplips.com/",
};

/** Media is immutable enough to cache hard at the CDN. */
const MEDIA_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

/** Response headers worth passing through untouched. */
const PASS_THROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

/** Request headers that let the host answer "you already have this". */
const CONDITIONAL = ["if-none-match", "if-modified-since", "if-range"];

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

  const headers: Record<string, string> = { ...UPSTREAM_HEADERS };
  const range = req.headers.get("range");
  if (range) headers.range = range;
  for (const name of CONDITIONAL) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers, redirect: "follow", cache: "no-store" });
  } catch {
    return badRequest("The media host could not be reached", 502, "unreachable");
  }

  const isMediaPath = /\.[a-z0-9]+$/i.test(target.pathname);

  // `?probe=1` answers with what the host said instead of streaming, so the
  // route can be checked from anywhere without downloading a film.
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
    void upstream.body?.cancel().catch(() => undefined);
    return Response.json(summary, { headers: { "cache-control": "no-store" } });
  }

  if (upstream.status === 304) {
    void upstream.body?.cancel().catch(() => undefined);
    const notModified = new Headers();
    for (const name of ["etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) notModified.set(name, value);
    }
    notModified.set("cache-control", MEDIA_CACHE_CONTROL);
    return new Response(null, { status: 304, headers: notModified });
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
  if (!responseHeaders.has("content-type") && isMediaPath) {
    const ext = /\.([a-z0-9]+)$/i.exec(target.pathname)?.[1]?.toLowerCase();
    if (ext === "mp4" || ext === "m4v") responseHeaders.set("content-type", "video/mp4");
    if (ext === "webm") responseHeaders.set("content-type", "video/webm");
  }

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
