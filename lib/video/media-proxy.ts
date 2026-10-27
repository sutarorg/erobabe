/**
 * Same-origin URLs for every destination the proxy is allowed to serve.
 *
 * damplips media needs no proof: the proxy already refuses any other host. A
 * URI discovered *inside* a damplips playlist may live on a media CDN, so it is
 * signed (see `media-token.ts`) instead of being dropped — dropping it is what
 * left HLS videos buffering forever or failing with "the video could not be
 * loaded".
 *
 * Server-only: signing needs `node:crypto`.
 */

import { damplipsProxyUrl, isDamplipsMediaUrl } from "./playback";
import { signMediaUrl } from "./media-token";

/** Public https host check shared with the route; duplicated to stay pure. */
function isPublicHttps(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return Boolean(url.hostname) && url.hostname.includes(".");
}

/**
 * A same-origin URL that streams `url`, or `null` when the destination cannot
 * be proxied at all.
 */
export function proxiedMediaUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  // The host only answers over https, and playlists sometimes publish http
  // links; upgrade before signing so the signature covers the URL we fetch.
  if (parsed.protocol === "http:") parsed.protocol = "https:";

  const target = parsed.toString();
  if (isDamplipsMediaUrl(target)) return damplipsProxyUrl(target);
  if (!isPublicHttps(parsed)) return null;
  return `${damplipsProxyUrl(target)}&t=${encodeURIComponent(signMediaUrl(target))}`;
}
