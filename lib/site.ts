export const LOGO_URL =
  "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://erobabe.com";

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
