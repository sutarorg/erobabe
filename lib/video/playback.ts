/**
 * Which destination the watch page may hand to a player.
 *
 * The catalog now embeds damplips.com: a row stores the media URL the damplips
 * post page itself serves (an mp4/HLS file or a player URL) plus the page it
 * came from. Uploaded providers are retired, so a row still pointing at one is
 * reported as unsupported rather than handed to an iframe.
 *
 * A **direct file** — what damplips publishes today, e.g.
 * `https://video.damplips.com/video7/717/79.mp4` — is never "prepared": the
 * browser streams it from the host exactly like damplips' own player does, and
 * the same-origin proxy is only the fallback. Routing every file through the
 * proxy first meant a server hop through Cloudflare before a single byte could
 * reach the element, which is what left the player buffering.
 */

import { isHlsUrl } from "./hls";

export type PlaybackSource =
  | { kind: "direct" | "embed"; url: string }
  | { kind: "missing" | "unsupported" };

/** Providers whose media no longer has a working player on this site. */
const RETIRED_PROVIDERS = new Set(["bunny", "streamtape", "ufoload", "uqload", "filekosh", "archived"]);

const DAMPLIPS_DOMAIN = /(^|\.)damplips\.com$/i;

export function isDamplipsHostname(hostname: string): boolean {
  return DAMPLIPS_DOMAIN.test(hostname.toLowerCase());
}

export function isDamplipsMediaUrl(url: string): boolean {
  try {
    return isDamplipsHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * A damplips post page (`/p/<id>/`) is an HTML document, not a video file.
 *
 * Some imports stored that page in `playable_url`. Handing it straight to a
 * `<video>` element only ever produced "the video could not be loaded", so the
 * player sends it to the stream proxy instead: the proxy reads the page, takes
 * the media URL the page itself advertises, and streams that. Either way the
 * video plays in our own player, never inside damplips' page.
 */
export function isDamplipsPostPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isDamplipsHostname(parsed.hostname) && /^\/p\/\d+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Same-origin URL that streams a media destination through our route.
 *
 * Used when the browser cannot take the file itself: a damplips post page has
 * to be resolved into its file, and a playlist has to be rewritten so its
 * segments come back through this origin.
 */
export function streamProxyUrl(url: string): string {
  return `/api/videos/stream?src=${encodeURIComponent(url)}`;
}

/**
 * Same-origin URL that streams a damplips *file* through the edge route.
 *
 * The Node proxy is challenged by the media host on every request it makes, so
 * it can resolve pages and rewrite playlists but can never deliver these bytes.
 * Edge egress is not challenged, which is why media playback uses this route
 * while anything that needs HTML parsing stays on the Node one.
 */
export const EDGE_STREAM_PATH = "/api/videos/stream-edge";

export function edgeStreamUrl(url: string): string {
  // `v=2` drops browsers that cached a 206 under the previous CDN policy.
  return `${EDGE_STREAM_PATH}?src=${encodeURIComponent(url)}&v=2`;
}

/** Kept as the name the rest of the player and its tests use. */
export const damplipsProxyUrl = streamProxyUrl;

/** True for a URL produced by either proxy helper — i.e. served by this origin. */
export function isStreamProxyUrl(url: string): boolean {
  return url.startsWith("/api/videos/stream?") || url.startsWith(`${EDGE_STREAM_PATH}?`);
}

/**
 * Every destination worth trying for one catalog row, best first.
 *
 * The order is the whole point:
 *
 *  - a plain file is tried **directly first**. damplips serves its mp4s from a
 *    public host, so the browser streams them the way damplips' own player
 *    does; the proxy is the fallback for a host that rejects the request;
 *  - a playlist goes through the proxy first, because its segment URIs have to
 *    be rewritten to this origin (and hls.js needs them same-origin or CORS
 *    friendly). The raw URL stays as a second attempt for Safari, which can
 *    take a playlist natively;
 *  - a post page is HTML: only the proxy can turn it into media.
 */
export function playbackCandidates(url: string): string[] {
  if (!isDamplipsMediaUrl(url)) return [url];
  // A post page has to be turned into media first, and a playlist has to have
  // its segment URIs rewritten: both need the Node proxy's parser.
  if (isDamplipsPostPage(url)) return [damplipsProxyUrl(url)];
  if (isHlsUrl(url)) return [damplipsProxyUrl(url), url];
  // The visitor's browser often cannot take the host file (hotlink rules,
  // missing referer, ISP filters). Waiting on that request is what left the
  // player spinning for many seconds. The edge proxy already has the right
  // referer and is not challenged, so it is the first request; the raw file
  // stays as a fallback.
  // Only the edge proxy: a raw host request from this origin is what produced
  // "media error 4" after the proxy already failed (hotlink / no referer).
  return [edgeStreamUrl(url)];
}

function safeUrl(raw: string | null | undefined, allowedProtocols: RegExp): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!allowedProtocols.test(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Hosts whose stored files cannot be refreshed or trusted after retirement. */
const RETIRED_MEDIA_HOSTS = /(^|\.)(streamtape\.(com|net|to)|tapecontent\.net|mediadelivery\.net)$/i;

function isRetiredMediaHost(url: URL): boolean {
  return RETIRED_MEDIA_HOSTS.test(url.hostname);
}

/** YouTube/Vimeo players are the only non-damplips embeds accepted. */
function isApprovedNonDamplipsEmbed(url: URL): boolean {
  if (url.protocol !== "https:" || url.port) return false;
  if (url.hostname === "www.youtube-nocookie.com" || url.hostname === "www.youtube.com") {
    return /^\/embed\/[A-Za-z0-9_-]+$/.test(url.pathname);
  }
  return url.hostname === "player.vimeo.com" && /^\/video\/\d+$/.test(url.pathname);
}

/**
 * Resolves the playable destination of a catalog row.
 *
 * Order matters: a direct file plays in our own player (with our poster and our
 * analytics), so it wins over an embed of someone else's page.
 */
export function selectPlaybackSource(
  playableUrl?: string | null,
  embedUrl?: string | null,
  provider?: string | null,
): PlaybackSource {
  if (provider && RETIRED_PROVIDERS.has(provider)) return { kind: "unsupported" };

  const direct = safeUrl(playableUrl, /^https?:$/);
  if (direct) {
    if (isRetiredMediaHost(direct)) return { kind: "unsupported" };
    // A post page stored as a "file" is resolved to real media by the stream
    // proxy, so it is still a direct source for our own player.
    return { kind: "direct", url: direct.toString() };
  }

  const embed = safeUrl(embedUrl, /^https?:$/);
  if (embed && !isRetiredMediaHost(embed)) {
    // damplips never allows its pages to be framed, and its post pages are
    // resolvable to a real file: play those in our player through the proxy.
    if (isDamplipsMediaUrl(embed.toString())) {
      return { kind: "direct", url: embed.toString() };
    }
    if (isApprovedNonDamplipsEmbed(embed)) return { kind: "embed", url: embed.toString() };
    return { kind: "unsupported" };
  }

  return { kind: "missing" };
}
