/* ──────────────────────────────────────────────────────────────
 * Traffic attribution helpers — classify a referrer into
 * direct / search / social / referral and derive a device class.
 * ────────────────────────────────────────────────────────────── */

const SEARCH = [
  "google.", "bing.", "duckduckgo.", "yahoo.", "yandex.", "baidu.",
  "ecosia.", "brave.", "startpage.", "search.",
];

const SOCIAL = [
  "t.co", "twitter.", "x.com", "facebook.", "fb.", "instagram.", "reddit.",
  "t.me", "telegram.", "whatsapp.", "wa.me", "tiktok.", "snapchat.",
  "pinterest.", "tumblr.", "discord.", "linkedin.", "youtube.", "vk.com",
];

const has = (host, list) => list.some((frag) => host === frag || host.includes(frag));

/** → { source, host } for a raw referrer URL relative to our own host. */
export function classifyReferrer(referrer, selfHost = "") {
  if (!referrer) return { source: "direct", host: null };
  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { source: "direct", host: null };
  }
  if (!host) return { source: "direct", host: null };
  const self = String(selfHost).toLowerCase().replace(/^www\./, "");
  if (self && (host === self || host.endsWith(`.${self}`))) return { source: "internal", host };
  if (has(host, SEARCH)) return { source: "search", host };
  if (has(host, SOCIAL)) return { source: "social", host };
  return { source: "referral", host };
}

/** Coarse device class from the User-Agent string. */
export function deviceFromUA(ua = "") {
  const s = String(ua).toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(s)) return "tablet";
  if (/mobi|iphone|android|phone/.test(s)) return "mobile";
  if (/smart-?tv|appletv|googletv|hbbtv/.test(s)) return "tv";
  if (!s) return "unknown";
  return "desktop";
}
