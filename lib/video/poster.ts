/**
 * Catalog posters, served through this site.
 *
 * A poster is a remote image on an adult CDN, and there are three ordinary
 * reasons a browser fails to show one:
 *
 *  1. **Ad blockers.** `damplips.com` is on the block lists, so a perfectly valid `<img src="https://…damplips.com/…">`
 *     never leaves the page. The card is a blank box.
 *  2. **Hotlink protection.** Some poster paths only answer a request that
 *     carries the site's own referer, and answer a foreign one with 403.
 *  3. **A stale or wrong value.** A row whose `thumbnail_url` was stored as a
 *     watch page, or on a host that no longer serves it.
 *
 * So the card asks **our** origin for the picture. `/api/videos/poster` fetches
 * it with the referer the CDN expects, checks that the answer really is an
 * image, and caches it for a year. The browser never talks to the CDN, an
 * extension cannot block the request, and the bytes are cached at the edge.
 *
 * If the proxy cannot get the image the card falls back to the CDN URL directly,
 * and only then to the erobabe mark — nothing is ever left blank.
 *
 * This module is imported by client components, so it stays free of server-only
 * dependencies: it only inspects strings.
 */

/** Same-origin endpoint that fetches a poster on the browser's behalf. */
export const POSTER_PROXY_PATH = "/api/videos/poster";

/** Hosts whose posters may be proxied. Everything else is rendered as-is. */
const POSTER_HOST_SUFFIXES = ["damplips.com"];

const IMAGE_PATH = /\.(jpe?g|png|webp|avif|gif)$/i;

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return POSTER_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Absolute https URL of a poster on an allowed CDN, or null. */
export function posterProxyTarget(value: string | null | undefined): URL | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed || /^(data|javascript|blob):/i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!hostAllowed(url.hostname)) return null;
  if (!IMAGE_PATH.test(url.pathname)) return null;
  return url;
}

/** True when this URL is a picture we would proxy. */
export function isProxiablePoster(value: string | null | undefined): boolean {
  return posterProxyTarget(value) != null;
}

/** The same-origin URL a card should use first, or null when it is not proxied. */
export function proxiedPosterUrl(value: string | null | undefined): string | null {
  const target = posterProxyTarget(value);
  if (!target) return null;
  return `${POSTER_PROXY_PATH}?src=${encodeURIComponent(target.toString())}`;
}

/**
 * Every URL a card should try, in order.
 *
 * The proxy comes first, the CDN URL second (it works when the proxy is down or
 * a deployment predates it), and an empty list when there is nothing to show.
 */
export function posterSources(value: string | null | undefined): string[] {
  const raw = typeof value === "string" ? value.trim() : "";
  const proxy = proxiedPosterUrl(raw);
  const direct = /^https?:\/\//i.test(raw) ? raw : "";
  const sources = [proxy, direct].filter((entry): entry is string => Boolean(entry));
  return [...new Set(sources)];
}
