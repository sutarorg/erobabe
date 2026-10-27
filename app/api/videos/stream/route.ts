import { NextRequest } from "next/server";
import { isDamplipsMediaUrl } from "@/lib/video/playback";

/**
 * Same-origin playback proxy for damplips media.
 *
 * damplips serves its files from its own host and expects a damplips referer.
 * The browser therefore asks this route, and this route asks damplips with the
 * headers the file expects. Only damplips https URLs are ever fetched, so the
 * route cannot be used as an open proxy. Bytes are streamed, never stored.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REDIRECTS = 3;
const MEDIA_REFERER = "https://www.damplips.com/";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PASS_THROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

function badRequest(message: string, status = 400) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function proxy(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("src");
  if (!raw) return badRequest("A src parameter is required");

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return badRequest("src must be an absolute URL");
  }
  if (target.protocol !== "https:" || target.username || target.password) {
    return badRequest("src must be an https URL without credentials");
  }
  if (!isDamplipsMediaUrl(target.toString())) {
    return badRequest("Only damplips media can be streamed here", 403);
  }

  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    referer: MEDIA_REFERER,
    origin: "https://www.damplips.com",
    accept: "*/*",
  };
  const range = req.headers.get("range");
  if (range) headers.range = range;

  let upstream: Response | null = null;
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, { headers, redirect: "manual", cache: "no-store" });
    } catch {
      return badRequest("The media host could not be reached", 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return badRequest("The media host redirected without a location", 502);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return badRequest("The media host redirected to an invalid URL", 502);
      }
      if (!isDamplipsMediaUrl(next.toString()) || next.protocol !== "https:") {
        return badRequest("The media host redirected off damplips", 502);
      }
      current = next;
      continue;
    }
    upstream = response;
    break;
  }

  if (!upstream) return badRequest("Too many redirects", 502);
  if (!upstream.ok && upstream.status !== 206) {
    return badRequest(`The media host responded ${upstream.status}`, 502);
  }
  if (!upstream.body) return badRequest("The media host returned no body", 502);

  const responseHeaders = new Headers();
  for (const name of PASS_THROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (!responseHeaders.has("accept-ranges")) responseHeaders.set("accept-ranges", "bytes");
  responseHeaders.set("cache-control", "public, max-age=600");

  return new Response(req.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest) {
  return proxy(req);
}

export async function HEAD(req: NextRequest) {
  return proxy(req);
}
