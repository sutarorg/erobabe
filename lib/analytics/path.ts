/**
 * Normalisation for the two pieces of request context analytics keeps:
 * the page path and the referrer host/path.
 *
 * A path is stored without query string, fragment or trailing slash, and only
 * for the public website: the dashboard, the API and the advertising checkout
 * are private surfaces and never appear in a traffic report. A referrer is
 * reduced to its host (lower case, `www.` removed) because the full URL can
 * carry somebody's search terms.
 */

export const MAX_PATH_LENGTH = 400;

/** Paths that are never measured. */
const PRIVATE_PREFIXES = ["/admin", "/api", "/auth", "/checkout", "/_next", "/monitoring"];

export type NormalizedPath = { path: string; utm: UtmTags };

export type UtmTags = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
};

const EMPTY_UTM: UtmTags = { source: null, medium: null, campaign: null };

function cleanTag(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 80);
  return trimmed || null;
}

/** `?utm_source=newsletter&utm_medium=email` → tags, ignoring everything else. */
export function parseUtm(search: string | null | undefined): UtmTags {
  if (!search) return EMPTY_UTM;
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return {
      source: cleanTag(params.get("utm_source")),
      medium: cleanTag(params.get("utm_medium")),
      campaign: cleanTag(params.get("utm_campaign")),
    };
  } catch {
    return EMPTY_UTM;
  }
}

/** True for a public page path that may be measured. */
export function isTrackablePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.length > MAX_PATH_LENGTH) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return !PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Normalises a pathname (plus optional search string) for storage.
 *
 * Returns null for anything that is not a measurable public page, which is how
 * a crafted beacon for `/admin/analytics` or an absolute URL is dropped instead
 * of being written to the report.
 */
export function normalizePath(
  pathname: string | null | undefined,
  search?: string | null,
): NormalizedPath | null {
  if (!pathname) return null;
  let value = String(pathname).trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  const hashIndex = value.indexOf("#");
  if (hashIndex >= 0) value = value.slice(0, hashIndex);
  const queryIndex = value.indexOf("?");
  const inlineSearch = queryIndex >= 0 ? value.slice(queryIndex) : null;
  if (queryIndex >= 0) value = value.slice(0, queryIndex);

  // Collapse slashes and drop the trailing one (except the root).
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1 && value.endsWith("/")) value = value.replace(/\/+$/, "");
  if (!value) value = "/";
  if (value.length > MAX_PATH_LENGTH) value = value.slice(0, MAX_PATH_LENGTH);

  if (!isTrackablePath(value)) return null;

  return { path: value, utm: parseUtm(search ?? inlineSearch) };
}

export type NormalizedReferrer = { host: string; path: string | null };

/**
 * Reduces a referrer URL to host + path.
 *
 * Returns null when there is nothing worth storing: no referrer, a malformed
 * one, a non-http(s) scheme, or a referrer that is this site (an internal
 * navigation is not an acquisition source).
 */
export function normalizeReferrer(
  referrer: string | null | undefined,
  siteHost?: string | null,
): NormalizedReferrer | null {
  if (!referrer) return null;
  const raw = String(referrer).trim();
  if (!raw || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "").slice(0, 200);
  if (!host) return null;
  const self = (siteHost || "").toLowerCase().replace(/^www\./, "");
  if (self && (host === self || host.endsWith(`.${self}`))) return null;
  // Our own preview domains are internal navigations too.
  if (host.endsWith(".e2b.app") || host === "localhost" || host === "127.0.0.1") return null;

  const path = url.pathname && url.pathname !== "/" ? url.pathname.slice(0, 200) : null;
  return { host, path };
}

const REFERRER_LABELS: Array<[RegExp, string]> = [
  [/google\./, "Google"],
  [/bing\./, "Bing"],
  [/duckduckgo\./, "DuckDuckGo"],
  [/yahoo\./, "Yahoo"],
  [/yandex\./, "Yandex"],
  [/baidu\./, "Baidu"],
  [/facebook\.|fb\./, "Facebook"],
  [/instagram\./, "Instagram"],
  [/(^|\.)t\.co$|twitter\.|x\.com$/, "X (Twitter)"],
  [/reddit\./, "Reddit"],
  [/tiktok\./, "TikTok"],
  [/pinterest\./, "Pinterest"],
  [/youtube\.|youtu\.be$/, "YouTube"],
  [/linkedin\./, "LinkedIn"],
  [/telegram\.|t\.me$/, "Telegram"],
  [/whatsapp\./, "WhatsApp"],
];

/** Human label for a referrer host, used by the tables. */
export function referrerLabel(host: string | null | undefined): string {
  if (!host) return "Direct";
  const normalized = host.toLowerCase().replace(/^www\./, "");
  for (const [pattern, label] of REFERRER_LABELS) {
    if (pattern.test(normalized)) return label;
  }
  return normalized;
}

/** A readable label for a page path. */
export function pageLabel(path: string): string {
  if (path === "/") return "Home";
  if (path === "/latest") return "Latest";
  if (path === "/popular") return "Popular";
  if (path === "/categories") return "Categories";
  const video = path.match(/^\/video\/(.+)$/);
  if (video) return `Video · ${video[1]}`;
  const category = path.match(/^\/category\/(.+)$/);
  if (category) return `Category · ${category[1]}`;
  return path;
}

/** The path segment used by `/admin/analytics/pages/[...path]`. */
export function pathToSlug(path: string): string[] {
  return path.replace(/^\//, "").split("/").filter(Boolean);
}

/** Inverse of {@link pathToSlug}, for the detail page. */
export function slugToPath(segments: string[] | undefined): string {
  const joined = (segments || []).filter(Boolean).join("/");
  return joined ? `/${joined}` : "/";
}
