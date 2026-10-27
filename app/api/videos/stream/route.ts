import { NextRequest } from "next/server";
import { isDamplipsMediaUrl } from "@/lib/video/playback";
import { isHlsContentType, isHlsUrl, isHtmlContentType, rewriteHlsPlaylist } from "@/lib/video/hls";
import { proxiedMediaUrl } from "@/lib/video/media-proxy";
import { verifyMediaToken } from "@/lib/video/media-token";
import { parseMedia } from "@/lib/damplips/parse";

/**
 * Same-origin playback proxy.
 *
 * The browser never talks to damplips directly. It asks this route, and this
 * route asks the media host with the headers the file expects (damplips
 * referer-checks and hotlink-protects its files). Three kinds of destination
 * arrive here:
 *
 *  1. A damplips media file — streamed through, `Range` and all.
 *  2. A damplips **post page** — an HTML document. The page is read, the media
 *     URL it advertises is extracted with the same parser the importer uses,
 *     and that file is streamed instead. This is why a row whose
 *     `playable_url` is a page still plays in our own player.
 *  3. An HLS playlist — rewritten so every segment, key and nested rendition is
 *     fetched through this route rather than straight from damplips.
 *
 * Segments of a damplips playlist often live on a media CDN outside
 * damplips.com. Those URIs are proxied with a short-lived signature minted by
 * `proxiedMediaUrl`, so a real playlist plays end to end while the endpoint
 * stays closed as an open proxy. Bytes are streamed, never stored.
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

/** A post page is HTML; a hostile one must not be allowed to exhaust memory. */
const MAX_PAGE_BYTES = 512 * 1024;
/** A page that points at another page that points at another… is a loop. */
const MAX_PAGE_HOPS = 2;
/** Post-page → media resolution is cached: a `<video>` makes many requests. */
const RESOLVED_TTL_MS = 5 * 60 * 1000;
const RESOLVED_LIMIT = 250;

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

/**
 * damplips media needs no proof. Anything else must present a signature the
 * playlist rewriter minted for exactly that URL.
 */
function parseSource(raw: string, token: string | null): SourceResult {
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
  if (isPrivateHost(target.hostname)) {
    return { error: "src must be a public host", status: 403 };
  }
  const resolved = target.toString();
  if (isDamplipsMediaUrl(resolved)) return { url: target };
  if (verifyMediaToken(resolved, token)) return { url: target };
  return { error: "Only damplips media can be streamed here", status: 403 };
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

/** Reads at most `MAX_PAGE_BYTES` of a document, then drops the connection. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (size < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    /* Keep whatever was read; a truncated page may still name its media. */
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

const resolutions = new Map<string, { url: string; at: number }>();

function rememberResolution(from: string, to: string) {
  const now = Date.now();
  for (const [key, value] of resolutions) {
    if (now - value.at > RESOLVED_TTL_MS) resolutions.delete(key);
  }
  if (resolutions.size >= RESOLVED_LIMIT) {
    const oldest = resolutions.keys().next().value;
    if (oldest) resolutions.delete(oldest);
  }
  resolutions.set(from, { url: to, at: now });
}

function rememberedResolution(from: string): URL | null {
  const hit = resolutions.get(from);
  if (!hit) return null;
  if (Date.now() - hit.at > RESOLVED_TTL_MS) {
    resolutions.delete(from);
    return null;
  }
  try {
    return new URL(hit.url);
  } catch {
    return null;
  }
}

/** Only this route may be handed a foreign host, and only when it signed it. */
function rewriteCallback(absolute: string): string | null {
  return proxiedMediaUrl(absolute);
}

async function proxy(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("src");
  if (!raw) return badRequest("A src parameter is required");

  const parsed = parseSource(raw, req.nextUrl.searchParams.get("t"));
  if ("error" in parsed) return badRequest(parsed.error, parsed.status);

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

  const requestedUrl = parsed.url;
  const cached = rememberedResolution(requestedUrl.toString());
  let current = cached ?? requestedUrl;
  let usingCache = cached !== null;

  for (let hop = 0; hop <= MAX_PAGE_HOPS; hop += 1) {
    const result = await fetchUpstream(current, headers);
    if (result instanceof Response) {
      // A remembered media URL can rot. Drop it and read the page again
      // instead of failing playback for the rest of the cache window.
      if (usingCache) {
        resolutions.delete(requestedUrl.toString());
        usingCache = false;
        current = requestedUrl;
        continue;
      }
      return result;
    }

    const { response: upstream, url: upstreamUrl } = result;
    if (!upstream.ok) {
      if (usingCache) {
        resolutions.delete(requestedUrl.toString());
        usingCache = false;
        current = requestedUrl;
        continue;
      }
      return badRequest(`The media host responded ${upstream.status}`, 502);
    }
    usingCache = false;

    // A post page: read it, take the media destination it advertises, and go
    // back around. This is the difference between a framed damplips page and a
    // video that plays in our own player.
    if (isHtmlContentType(upstream.headers.get("content-type"))) {
      const html = await readCapped(upstream);
      const media = parseMedia(html, upstreamUrl.toString());
      if (!media || media.kind !== "direct") {
        return badRequest("The source page did not publish a playable file", 502);
      }
      let next: URL;
      try {
        next = new URL(media.url, upstreamUrl);
      } catch {
        return badRequest("The source page published an unusable media URL", 502);
      }
      if (next.protocol === "http:") next.protocol = "https:";
      if (!isAllowedHop(next)) {
        return badRequest("The source page pointed at an unusable host", 502);
      }
      if (next.toString() === upstreamUrl.toString()) {
        return badRequest("The source page pointed at itself", 502);
      }
      rememberResolution(requestedUrl.toString(), next.toString());
      current = next;
      continue;
    }

    const contentType = upstream.headers.get("content-type");
    const playlist = isHlsContentType(contentType) || isHlsUrl(upstreamUrl.toString());

    if (playlist) {
      // A playlist is text: read it, point every URI back at this route, and
      // hand the player a document it can resolve without touching damplips.
      let manifest: string;
      try {
        manifest = await upstream.text();
      } catch {
        return badRequest("The media playlist could not be read", 502);
      }
      const rewritten = rewriteHlsPlaylist(manifest, upstreamUrl.toString(), rewriteCallback);
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

  return badRequest("The source page kept pointing at another page", 502);
}

export async function GET(req: NextRequest) {
  return proxy(req);
}

export async function HEAD(req: NextRequest) {
  return proxy(req);
}
