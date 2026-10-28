import { NextRequest } from "next/server";
import { isDamplipsMediaUrl } from "@/lib/video/playback";
import { isHlsContentType, isHlsUrl, isHtmlContentType, rewriteHlsPlaylist } from "@/lib/video/hls";
import { proxiedMediaUrl } from "@/lib/video/media-proxy";
import { verifyMediaToken } from "@/lib/video/media-token";
import {
  forgetPageMedia,
  readPageMedia,
  recallPageMedia,
  rememberPageMedia,
} from "@/lib/video/page-media";

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

/**
 * How long the media host may take to answer.
 *
 * Only the **headers** are on a clock: a 10-minute mp4 has to be allowed to
 * stream for 10 minutes, so the timer is cleared the moment a response arrives.
 * Without this, a host that accepts the connection and then never answers held
 * the request — and therefore the player, on "Preparing video…" — until the
 * function timed out. Override with `MEDIA_UPSTREAM_TIMEOUT_MS`.
 */
const DEFAULT_UPSTREAM_TIMEOUT_MS = 12_000;

function upstreamTimeoutMs(): number {
  const configured = Number(process.env.MEDIA_UPSTREAM_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 1_000) return DEFAULT_UPSTREAM_TIMEOUT_MS;
  return Math.min(configured, 120_000);
}

/**
 * A media type for a file the host labelled generically.
 *
 * Every response from this app carries `X-Content-Type-Options: nosniff`, and a
 * `<video>` element handed `application/octet-stream` is at the mercy of the
 * browser's media sniffing. Naming the container makes playback predictable.
 */
const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  ogg: "video/ogg",
  ts: "video/mp2t",
};

const GENERIC_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/unknown",
  "application/x-download",
  "",
]);

function mediaTypeFor(url: URL, contentType: string | null): string | null {
  const declared = (contentType || "").split(";")[0]?.trim().toLowerCase() || "";
  if (!GENERIC_CONTENT_TYPES.has(declared)) return null;
  const match = /\.([a-z0-9]+)$/i.exec(url.pathname);
  if (!match) return null;
  return MEDIA_TYPES[match[1].toLowerCase()] || null;
}

const PASS_THROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "content-encoding",
  "accept-ranges",
  "etag",
  "last-modified",
];

/**
 * Media is immutable enough to cache hard: the URL identifies one file, and a
 * browser or edge that already holds the bytes should never ask us again. This
 * is what makes a repeat play start instantly, and what lets a CDN absorb the
 * traffic of a popular video instead of every range request hitting a function.
 */
const MEDIA_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
/** A playlist changes when the packager rolls it; keep its window short. */
const PLAYLIST_CACHE_CONTROL = "public, max-age=30, s-maxage=60";

/** Request headers that let an upstream answer "you already have this". */
const CONDITIONAL_HEADERS = ["if-none-match", "if-range", "if-modified-since"];

/** A page that points at another page that points at another… is a loop. */
const MAX_PAGE_HOPS = 2;

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
 * The browser the proxy presents to the media host.
 *
 * A user-agent alone is not enough. Cloudflare — which fronts damplips' media
 * host — scores a request whose UA claims Chrome but which sends none of
 * Chrome's client hints (`sec-ch-ua`, `sec-fetch-*`) as a bot and answers 403.
 * That is exactly what happened in production: the same file loaded fine in a
 * browser and through other fetchers, while this route got "403" from every
 * header profile it tried. The profiles below are complete, self-consistent
 * fingerprints rather than a UA string with a referer bolted on.
 */
const UA_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Headers every attempt sends. `identity` keeps the body decodable. */
const BASE_HEADERS: Record<string, string> = {
  "user-agent": UA_WINDOWS,
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "accept-encoding": "identity",
};

/** A full Chromium client-hint set, as `<video>` itself would send it. */
const CHROMIUM_HEADERS: Record<string, string> = {
  "sec-ch-ua": '"Chromium";v="126", "Not:A-Brand";v="24", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "video",
  "sec-fetch-mode": "no-cors",
  "sec-fetch-site": "same-origin",
  "upgrade-insecure-requests": "1",
};

type HeaderProfile = { name: string; headers: Record<string, string> };

/**
 * Profiles for the media host, most likely first.
 *
 * Damplips' own player asks for the file with its site referer and a same-origin
 * fetch, so that is attempt one — it is the request the host is built to accept.
 * The rest relax one thing at a time (an `Origin`, cross-site, a bare request)
 * because hotlink protection is configured differently on each of its hosts.
 */
const HEADER_PROFILES: HeaderProfile[] = [
  { name: "browser+referer", headers: { ...BASE_HEADERS, ...CHROMIUM_HEADERS, referer: MEDIA_REFERER } },
  {
    name: "browser+referer+origin",
    headers: {
      ...BASE_HEADERS,
      ...CHROMIUM_HEADERS,
      referer: MEDIA_REFERER,
      origin: "https://www.damplips.com",
    },
  },
  {
    name: "browser-cross-site",
    headers: { ...BASE_HEADERS, ...CHROMIUM_HEADERS, "sec-fetch-site": "cross-site" },
  },
  { name: "plain+referer", headers: { ...BASE_HEADERS, referer: MEDIA_REFERER } },
  { name: "plain", headers: { ...BASE_HEADERS } },
];

/** Statuses that mean "the host did not like this request", not "no file". */
const REJECTED = new Set([401, 403, 451]);

/** One attempt against the media host, kept for the diagnostic response. */
export type UpstreamAttempt = { profile: string; status: number | null; error?: string };

async function requestUpstream(
  url: URL,
  base: Record<string, string>,
  log?: UpstreamAttempt[],
): Promise<Response | null> {
  let response: Response | null = null;
  for (const profile of HEADER_PROFILES) {
    // A fresh controller per attempt: an aborted signal can never be reused,
    // and the timer is cleared as soon as headers arrive so the body can stream
    // for as long as the file needs.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs());
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    try {
      response = await fetch(url, {
        headers: { ...base, ...profile.headers },
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });
      log?.push({ profile: profile.name, status: response.status });
    } catch (error) {
      // A refused connection, a DNS failure and a host that never answered in
      // time all mean the same thing: this destination is dead. Failing fast
      // lets the player try its other destination instead of waiting.
      log?.push({
        profile: profile.name,
        status: null,
        error: error instanceof Error ? error.message : "request failed",
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (!REJECTED.has(response.status)) return response;
  }
  return response;
}

/**
 * Follows redirects by hand so a redirect that leaves damplips is still only
 * followed to a public https host, and so we can report a precise failure.
 */
async function fetchUpstream(
  target: URL,
  headers: Record<string, string>,
  log?: UpstreamAttempt[],
): Promise<{ response: Response; url: URL } | Response> {
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestUpstream(current, headers, log);
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

/** Only this route may be handed a foreign host, and only when it signed it. */
function rewriteCallback(absolute: string): string | null {
  return proxiedMediaUrl(absolute);
}

async function proxy(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("src");
  if (!raw) return badRequest("A src parameter is required");

  const parsed = parseSource(raw, req.nextUrl.searchParams.get("t"));
  if ("error" in parsed) return badRequest(parsed.error, parsed.status);

  // Media must arrive uncompressed: the browser decodes the container, and a
  // transparently re-encoded body would fail to play. The browser fingerprint
  // itself lives in `BASE_HEADERS` / `HEADER_PROFILES`.
  const headers: Record<string, string> = { ...BASE_HEADERS };
  const range = req.headers.get("range");
  if (range) headers.range = range;
  for (const name of CONDITIONAL_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }

  const requestedUrl = parsed.url;
  // `?debug=1` turns the route into a diagnostic: it asks the media host the
  // same question it would ask for playback, and reports what came back
  // instead of streaming bytes. A 403 from Cloudflare is indistinguishable
  // from a dead file in a player, so this is the difference between "the
  // video is broken" and "this host does not like our request".
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const attempts: UpstreamAttempt[] = [];

  const cached = recallPageMedia(requestedUrl.toString());
  let current = cached ? new URL(cached) : requestedUrl;
  let usingCache = cached !== null;

  for (let hop = 0; hop <= MAX_PAGE_HOPS; hop += 1) {
    const result = await fetchUpstream(current, headers, debug ? attempts : undefined);
    if (debug) {
      const summary = result instanceof Response
        ? { ok: false, status: result.status, body: await result.clone().text().catch(() => "") }
        : {
            ok: result.response.ok,
            status: result.response.status,
            contentType: result.response.headers.get("content-type"),
            contentLength: result.response.headers.get("content-length"),
            acceptRanges: result.response.headers.get("accept-ranges"),
            finalUrl: result.url.toString(),
          };
      if (!(result instanceof Response)) void result.response.body?.cancel().catch(() => undefined);
      return Response.json(
        {
          requested: requestedUrl.toString(),
          profile: attempts.at(-1)?.profile ?? null,
          attempts,
          upstream: summary,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (result instanceof Response) {
      // A remembered media URL can rot. Drop it and read the page again
      // instead of failing playback for the rest of the cache window.
      if (usingCache) {
        forgetPageMedia(requestedUrl.toString());
        usingCache = false;
        current = requestedUrl;
        continue;
      }
      return result;
    }

    const { response: upstream, url: upstreamUrl } = result;
    // The browser already holds this byte range: hand back the validators and
    // let it reuse its copy instead of re-downloading the file.
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
      if (usingCache) {
        forgetPageMedia(requestedUrl.toString());
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
      // Reads only up to the media tag and cancels the rest of the page.
      const media = await readPageMedia(upstream, upstreamUrl.toString());
      if (!media) {
        return badRequest("The source page did not publish a playable file", 502);
      }
      let next: URL;
      try {
        next = new URL(media, upstreamUrl);
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
      rememberPageMedia(requestedUrl.toString(), next.toString());
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
          "cache-control": PLAYLIST_CACHE_CONTROL,
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
    // Never claim range support the host did not give us: a browser that seeks
    // against an honest `none` restarts cleanly, while a false `bytes` makes it
    // re-request ranges the host answers with the whole file over and over.
    if (!responseHeaders.has("accept-ranges") && upstream.status === 206) {
      responseHeaders.set("accept-ranges", "bytes");
    }
    const mediaType = mediaTypeFor(upstreamUrl, responseHeaders.get("content-type"));
    if (mediaType) responseHeaders.set("content-type", mediaType);
    responseHeaders.set("cache-control", MEDIA_CACHE_CONTROL);

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
