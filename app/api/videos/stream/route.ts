import { NextRequest } from "next/server";
import { damplipsProxyUrl, isDamplipsMediaUrl } from "@/lib/video/playback";
import { isHlsContentType, isHlsUrl, rewriteHlsPlaylist } from "@/lib/video/hls";

/**
 * Same-origin playback proxy for damplips media.
 *
 * damplips serves its files from its own host and expects a damplips referer,
 * so the browser asks this route and this route asks damplips with the headers
 * the file expects. Only damplips https URLs start a request, so the route
 * cannot be used as an open proxy. Bytes are streamed, never stored.
 *
 * HLS playlists are rewritten here (see `lib/video/hls.ts`): the player only
 * ever talks to this route, so segments cannot be blocked by CORS and relative
 * segment paths cannot resolve against the wrong base.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REDIRECTS = 4;
const MEDIA_REFERER = "https://www.damplips.com/";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PASS_THROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "content-encoding",
  "accept-ranges",
  "etag",
  "last-modified",
];

function badRequest(message: string, status = 400) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** Loopback, link-local and RFC1918 addresses are never a media source. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "::" || host === "0.0.0.0") return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (/^f[cd][0-9a-f]{0,2}:/i.test(host) || /^fe[89ab][0-9a-f]?:/i.test(host)) return true;
  return false;
}

/** A hop may leave damplips (media CDNs live elsewhere) but must stay public https. */
function isAllowedHop(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !isPrivateHost(url.hostname);
}

type SourceResult = { url: URL } | { error: string; status: number };

function parseSource(raw: string): SourceResult {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return { error: "src must be an absolute URL", status: 400 };
  }
  if (target.username || target.password) {
    return { error: "src must not carry credentials", status: 400 };
  }
  // damplips publishes http links in some listings; the host only answers over
  // https, so a plain-http source is upgraded rather than rejected.
  if (target.protocol === "http:") target.protocol = "https:";
  if (target.protocol !== "https:") {
    return { error: "src must be an https URL", status: 400 };
  }
  if (!isDamplipsMediaUrl(target.toString()) || isPrivateHost(target.hostname)) {
    return { error: "Only damplips media can be streamed here", status: 403 };
  }
  return { url: target };
}

/**
 * Header profiles for the media host, most browser-like first.
 *
 * Hotlink protection on tube sites is configured in many ways: some hosts want
 * the site referer, some reject a media request that carries an `Origin` at
 * all, and a few refuse anything but a bare request. Trying these in order is
 * far cheaper than a broken player.
 */
const HEADER_PROFILES: Array<Record<string, string>> = [
  { referer: MEDIA_REFERER, origin: "https://www.damplips.com" },
  { referer: MEDIA_REFERER },
  {},
];

/** Statuses that mean "the host did not like this request", not "no file". */
const REJECTED = new Set([401, 403, 451]);

async function requestUpstream(url: URL, base: Record<string, string>): Promise<Response | null> {
  let response: Response | null = null;
  for (const profile of HEADER_PROFILES) {
    try {
      response = await fetch(url, {
        headers: { ...base, ...profile },
        redirect: "manual",
        cache: "no-store",
      });
    } catch {
      return null;
    }
    if (!REJECTED.has(response.status)) return response;
  }
  return response;
}

/**
 * Follows redirects by hand so a redirect that leaves damplips is still only
 * followed to a public https host, and so we can report a precise failure.
 */
async function fetchUpstream(target: URL, headers: Record<string, string>): Promise<{ response: Response; url: URL } | Response> {
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestUpstream(current, headers);
    if (!response) return badRequest("The media host could not be reached", 502);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return badRequest("The media host redirected without a location", 502);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return badRequest("The media host redirected to an invalid URL", 502);
      }
      if (!isAllowedHop(next)) return badRequest("The media host redirected to an unusable location", 502);
      current = next;
      continue;
    }
    return { response, url: current };
  }
  return badRequest("Too many redirects", 502);
}

async function proxy(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("src");
  if (!raw) return badRequest("A src parameter is required");

  const parsed = parseSource(raw);
  if ("error" in parsed) return badRequest(parsed.error, parsed.status);
  const target = parsed.url;

  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    // Media must arrive uncompressed: the browser decodes the container, and a
    // transparently re-encoded body would fail to play.
    "accept-encoding": "identity",
  };
  const range = req.headers.get("range");
  if (range) headers.range = range;

  const result = await fetchUpstream(target, headers);
  if (result instanceof Response) return result;

  const { response: upstream, url: upstreamUrl } = result;
  if (!upstream.ok) {
    return badRequest(`The media host responded ${upstream.status}`, 502);
  }

  const contentType = upstream.headers.get("content-type");
  const playlist = isHlsContentType(contentType) || isHlsUrl(upstreamUrl.toString());

  if (playlist) {
    // A playlist is text: read it, point every URI back at this route, and hand
    // the player a document it can resolve without touching damplips directly.
    let manifest: string;
    try {
      manifest = await upstream.text();
    } catch {
      return badRequest("The media playlist could not be read", 502);
    }
    const rewritten = rewriteHlsPlaylist(manifest, upstreamUrl.toString(), (absolute) =>
      isDamplipsMediaUrl(absolute) ? damplipsProxyUrl(absolute) : null,
    );
    return new Response(req.method === "HEAD" ? null : rewritten, {
      status: 200,
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "public, max-age=30",
        "x-content-type-options": "nosniff",
      },
    });
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
