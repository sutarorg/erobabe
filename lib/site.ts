export const LOGO_URL =
  "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

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
