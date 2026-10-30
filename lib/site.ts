/** The wordmark used in the header, footer and age gate. */
export const LOGO_URL =
  "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

/**
 * How the brand is written wherever the name is text: titles, share cards,
 * structured data and the search results themselves.
 */
export const SITE_NAME = "EroBabe";

const FALLBACK_SITE_URL = "https://erobabe.com";

/**
 * Resolves the canonical site URL from NEXT_PUBLIC_SITE_URL.
 *
 * Tolerates the common deployment mistakes that would otherwise throw at
 * render time (e.g. a bare hostname without a protocol, a leftover
 * "your-domain.com" placeholder, or trailing slashes).
 */
export function getSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (!raw) return FALLBACK_SITE_URL;
  if (/(your-|your_|placeholder|example\.com|changeme)/i.test(raw)) return FALLBACK_SITE_URL;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname.includes(".")) return FALLBACK_SITE_URL;
    return parsed.origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}

export const SITE_URL = getSiteUrl();

/**
 * Brand assets we host ourselves. Google only shows a favicon it can reliably
 * crawl from the site that owns it, so none of these point at an image host.
 */
export const SITE_LOGO_PATH = "/brand/erobabe-logo.png";
export const SITE_LOGO_URL = `${SITE_URL}${SITE_LOGO_PATH}`;
/** Square mark used as the default share image when a page has no better one. */
export const SITE_OG_IMAGE = SITE_LOGO_URL;

export const SLOT_PRICE_CENTS = 9900;
export const SLOT_PRICE_USD = 99;

export function fmtUSD(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function categorySlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatDuration(seconds?: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * "2 days ago"-style publication age for watch pages and listings.
 *
 * Falls back to "Recently" when the date is missing or unparseable so the
 * metadata line never renders an empty or invalid timestamp.
 */
export function formatTimeAgo(value?: string | Date | null): string {
  if (!value) return "Recently";
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return "Recently";

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (days < 30) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;

  const months = Math.floor(days / 30);
  if (days < 365) return months === 1 ? "1 month ago" : `${months} months ago`;

  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
