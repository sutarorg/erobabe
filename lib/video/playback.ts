/**
 * Which destination the watch page may hand to a player.
 *
 * The catalog now embeds damplips.com: a row stores the media URL the damplips
 * post page itself serves (an mp4/HLS file or a player URL) plus the page it
 * came from. Uploaded providers are retired, so a row still pointing at one is
 * reported as unsupported rather than handed to an iframe.
 */

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
 * Same-origin URL that streams a damplips file through our route.
 *
 * damplips signs/referer-checks its media, so the browser asks our proxy and
 * the proxy asks damplips with the origin the file expects.
 */
export function damplipsProxyUrl(url: string): string {
  return `/api/videos/stream?src=${encodeURIComponent(url)}`;
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
    return isRetiredMediaHost(direct)
      ? { kind: "unsupported" }
      : { kind: "direct", url: direct.toString() };
  }

  const embed = safeUrl(embedUrl, /^https?:$/);
  if (embed && !isRetiredMediaHost(embed)) {
    if (isDamplipsMediaUrl(embed.toString())) return { kind: "embed", url: embed.toString() };
    if (isApprovedNonDamplipsEmbed(embed)) return { kind: "embed", url: embed.toString() };
    return { kind: "unsupported" };
  }

  return { kind: "missing" };
}
