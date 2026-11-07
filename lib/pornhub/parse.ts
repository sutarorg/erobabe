/**
 * pornhub.com HTML parsing.
 *
 * The catalog embeds Pornhub's own player: a row stores the video's viewkey, the
 * poster the search listing advertises, and the embed URL built from that
 * viewkey. Nothing is copied, re-hosted or proxied — the watch page frames
 * `https://www.pornhub.com/embed/<viewkey>`, exactly like the site's own share
 * dialog does.
 *
 * Everything in this module is a pure function over HTML, so the whole import
 * pipeline can be tested against saved pages without touching the network.
 *
 * ## Why the parser is written the way it is
 *
 * Pornhub ships its listing markup as server-rendered HTML whose wrapper class
 * names change every few months (`pcVideoListItem`, `videoBox`, …), but two
 * things have been stable for years and are part of the product rather than the
 * styling:
 *
 *   * every video is identified by a **viewkey**, and
 *   * every card links to `/view_video.php?viewkey=<viewkey>`.
 *
 * So cards are discovered from the viewkey (an attribute or the link), and the
 * metadata around each key is read from the slice of HTML that follows it,
 * stopping at the next card. Nothing depends on a class name surviving a
 * redesign, and a page with no recognisable cards is reported as empty instead
 * of silently importing garbage.
 */

/** Base site; the importer may be pointed at a test fixture server. */
export const PORNHUB_BASE_URL = "https://www.pornhub.com";

/** The share/embed player. This is the only URL the watch page frames. */
export const PORNHUB_EMBED_BASE = "https://www.pornhub.com/embed/";

/** Poster CDN hosts. A thumbnail from anywhere else is ignored. */
const THUMBNAIL_HOST_SUFFIXES = ["phncdn.com", "pornhub.com"];

export type PornhubCard = {
  /** Stable external identity: Pornhub's `viewkey`. */
  viewkey: string;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  /** Views the listing advertises ("1.2M" → 1_200_000), when it advertises one. */
  views: number | null;
  /**
   * `true`  — the listing labels the video HD;
   * `false` — the listing labels cards and this one is not HD;
   * `null`  — this page carries no HD marker at all, so the listing cannot say.
   */
  hd: boolean | null;
  sourceUrl: string;
};

export type PornhubListing = {
  cards: PornhubCard[];
  /** Highest page number the pagination links advertise, when they do. */
  totalPages: number | null;
  /** True when at least one card on the page carried an HD marker. */
  hdSignal: boolean;
};

export type PornhubDetail = {
  viewkey: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  /** Tallest stream the page advertises (1080, 720, …), or null if unknown. */
  maxHeight: number | null;
  sourceUrl: string;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[String(name).toLowerCase()] ?? match);
}

export function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function attribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = pattern.exec(tag);
  if (!match) return null;
  const raw = match[2] ?? match[3] ?? match[4] ?? "";
  return decodeEntities(raw.trim());
}

/** Absolute, credential-free http(s) URL, or null. */
export function toSafeUrl(value: string | null | undefined, base = PORNHUB_BASE_URL): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /^(data|javascript|blob):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Pornhub video identity from a watch link, an embed link or a bare key. */
export function viewkeyFromUrl(value: string): string | null {
  const text = String(value || "");
  const direct = /^[A-Za-z0-9]{6,32}$/.test(text.trim()) ? text.trim() : null;
  if (direct) return direct;
  const watch = /[?&]viewkey=([A-Za-z0-9]{6,32})/i.exec(text);
  if (watch) return watch[1];
  const embed = /\/embed\/([A-Za-z0-9]{6,32})(?:[/?#]|$)/i.exec(text);
  if (embed) return embed[1];
  return null;
}

/** The watch page a row is credited to. */
export function watchUrlFor(viewkey: string): string {
  return `${PORNHUB_BASE_URL}/view_video.php?viewkey=${encodeURIComponent(viewkey)}`;
}

/** The URL the watch page frames. No query string: nothing to spoof. */
export function embedUrlFor(viewkey: string): string {
  return `${PORNHUB_EMBED_BASE}${encodeURIComponent(viewkey)}`;
}

/**
 * Search the way a visitor would: the category name in the site's search box.
 *
 * `order` is Pornhub's own "Sort by" value — `mv` most viewed, `tr` top rated,
 * `cm` most commented, `mr` most recent. It is what lets an import take the
 * category's popular videos first instead of whatever happens to be newest.
 */
export function searchUrl(
  term: string,
  page = 1,
  baseUrl: string = PORNHUB_BASE_URL,
  order = "",
): string {
  const base = baseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({ search: term });
  if (page > 1) params.set("page", String(page));
  if (order) params.set("o", order);
  return `${base}/video/search?${params.toString()}`;
}

/** A poster URL on Pornhub's CDN, or null. Tracking beacons are rejected. */
export function normalizeThumbnail(raw: string | null | undefined, base?: string): string | null {
  const url = toSafeUrl(raw, base);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!THUMBNAIL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      return null;
    }
    if (/\.(gif|svg)(?:[?#]|$)/i.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** `12:34`, `1:02:03`, `754`, `PT12M34S` → seconds. */
export function parseDuration(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  const iso = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(text);
  if (iso && (iso[1] || iso[2] || iso[3])) {
    const seconds =
      Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Math.round(Number(iso[3] || 0));
    return seconds > 0 ? seconds : null;
  }

  const clock = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(text);
  if (clock) {
    const seconds =
      Number(clock[1] || 0) * 3600 + Number(clock[2] || 0) * 60 + Number(clock[3] || 0);
    return seconds > 0 && seconds < 86_400 ? seconds : null;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const seconds = Math.round(Number(text));
    return seconds > 0 && seconds < 86_400 ? seconds : null;
  }
  return null;
}

/**
 * A view label as a number: `1,234`, `1.2M`, `12K`, `1 234 views`.
 *
 * Pornhub prints counts abbreviated, so the exact figure is not recoverable —
 * but the magnitude is, which is what "popular first" needs (and what the card
 * shows as a real number rather than a guess).
 */
export function parseViews(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim().replace(/\u00a0/g, " ");
  if (!text) return null;

  const match = /([\d][\d.,\s]*)\s*([kKmMbB])?/.exec(text);
  if (!match) return null;
  const magnitude = match[2] ? { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2].toLowerCase() as "k" | "m" | "b"] : 1;

  const raw = match[1].replace(/\s/g, "");
  // `1.2M` uses a dot as the decimal separator; `1,234` uses commas as grouping.
  const digits = magnitude > 1 ? raw.replace(/,/g, ".") : raw.replace(/[.,]/g, "");
  const numeric = magnitude > 1
    ? Number(digits.split(".").slice(0, 2).join("."))
    : Number(digits);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const total = Math.round(numeric * magnitude);
  return total > 0 && total < 1_000_000_000_000 ? total : null;
}

/** Every position in the document where a card starts. */
function cardStarts(html: string): Array<{ viewkey: string; index: number }> {
  const starts: Array<{ viewkey: string; index: number }> = [];
  const pattern =
    /data-video-vkey\s*=\s*["']([A-Za-z0-9]{6,32})["']|[?&]viewkey=([A-Za-z0-9]{6,32})|\/embed\/([A-Za-z0-9]{6,32})/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const viewkey = match[1] || match[2] || match[3];
    if (!viewkey) continue;
    starts.push({ viewkey, index: match.index });
  }
  return starts;
}

/**
 * The slice of HTML that belongs to one card: from its key to the next key.
 *
 * The slice only ever looks **forward**. A card's own attributes sit on the same
 * tag as the viewkey (or the link that carries it), so everything belonging to
 * the card follows its key — while a lookback would silently steal the duration
 * or poster of the previous card.
 */
function cardChunk(html: string, index: number, nextIndex: number | null): string {
  const end = nextIndex ?? Math.min(html.length, index + 3000);
  return html.slice(index, end);
}

function firstOf(chunk: string, patterns: Array<RegExp | "attribute">): string | null {
  for (const pattern of patterns) {
    if (pattern === "attribute") continue;
    const match = pattern.exec(chunk);
    if (match?.[1] && match[1].trim()) return match[1].trim();
  }
  return null;
}

function titleFromChunk(chunk: string): string {
  const fromData = attribute(chunk, "data-title") || attribute(chunk, "data-video-title");
  if (fromData) return cleanTitle(fromData);

  const anchor = /<a\b[^>]*\btitle\s*=\s*["']([^"']+)["'][^>]*>/i.exec(chunk)?.[1];
  if (anchor) return cleanTitle(anchor);

  const image = /<img\b[^>]*\balt\s*=\s*["']([^"']+)["'][^>]*>/i.exec(chunk)?.[1];
  if (image) return cleanTitle(image);

  const inner = /<a\b[^>]*>[^<]*?([^<>\s][^<>]{2,})<\/a>/i.exec(chunk)?.[1];
  if (inner) return cleanTitle(inner);

  return "";
}

/** The widest candidate in a `srcset` value, or its first URL. */
function fromSrcset(value: string | null, base?: string): string | null {
  if (!value) return null;
  const candidates = value
    .split(",")
    .map((entry) => {
      const [url, descriptor] = entry.trim().split(/\s+/);
      const width = descriptor ? Number(/\.?(\d+(?:\.\d+)?)[wx]/i.exec(descriptor)?.[1]) : NaN;
      return { url, width: Number.isFinite(width) ? width : 0 };
    })
    .filter((entry) => Boolean(entry.url));
  candidates.sort((a, b) => b.width - a.width);
  for (const candidate of candidates) {
    const normalized = normalizeThumbnail(candidate.url, base);
    if (normalized) return normalized;
  }
  return null;
}

function thumbnailFromChunk(chunk: string, base?: string): string | null {
  for (const name of [
    "data-thumb_url",
    "data-mediumthumb",
    "data-image",
    "data-img",
    "data-src",
    "data-original",
    "data-posters",
    "poster",
  ]) {
    const candidate = normalizeThumbnail(attribute(chunk, name), base);
    if (candidate) return candidate;
  }

  const set = fromSrcset(attribute(chunk, "srcset") || attribute(chunk, "data-srcset"), base);
  if (set) return set;

  const direct = normalizeThumbnail(attribute(chunk, "src"), base);
  if (direct) return direct;

  // A poster painted as a CSS background (`style="background-image:url(…)"`).
  const background = /background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(chunk)?.[1];
  const fromBackground = normalizeThumbnail(background, base);
  if (fromBackground) return fromBackground;

  // Last resort: any absolute or protocol-relative CDN image URL in the chunk.
  const embedded =
    /(?:https?:)?\/\/[^\s"'<>\\]+?phncdn\.com[^\s"'<>\\]*\.(?:jpe?g|png|webp)[^\s"'<>\\]*/i.exec(
      chunk,
    );
  return embedded ? normalizeThumbnail(embedded[0], base) : null;
}

function viewsFromChunk(chunk: string): number | null {
  for (const name of ["data-video-views", "data-views", "data-view-count"]) {
    const direct = parseViews(attribute(chunk, name));
    if (direct != null) return direct;
  }
  const label = /<span\b[^>]*class\s*=\s*["'][^"']*\bviews\b[^"']*["'][^>]*>([\s\S]{0,120}?)<\/span>/i.exec(
    chunk,
  )?.[1];
  const fromLabel = parseViews(label ? stripTags(label) : null);
  if (fromLabel != null) return fromLabel;
  const json = /"views"\s*:\s*"?([\d.,]+\s*[KkMmBb]?)"?/.exec(chunk)?.[1];
  const fromJson = parseViews(json);
  if (fromJson != null) return fromJson;
  const inline = /([\d][\d.,]*\s*[KkMmBb]?)\s*(?:views|view)\b/i.exec(stripTags(chunk))?.[1];
  return parseViews(inline);
}

function durationFromChunk(chunk: string): number | null {
  const fromData = attribute(chunk, "data-duration");
  if (fromData) return parseDuration(fromData);
  const label = /<var\b[^>]*class\s*=\s*["'][^"']*\bduration\b[^"']*["'][^>]*>([^<]+)<\/var>/i.exec(
    chunk,
  )?.[1];
  if (label) return parseDuration(label);
  const generic = /<span\b[^>]*class\s*=\s*["'][^"']*\bduration\b[^"']*["'][^>]*>([^<]+)<\/span>/i.exec(
    chunk,
  )?.[1];
  return parseDuration(generic ?? null);
}

/** Does the chunk explicitly mark the video as HD, explicitly not, or neither? */
function hdFromChunk(chunk: string): boolean | null {
  const marker = attribute(chunk, "data-hd");
  if (marker === "1" || marker === "true") return true;
  if (marker === "0" || marker === "false") return false;
  if (/\bhd-thumbnail\b/i.test(chunk)) return true;
  if (/\bclass\s*=\s*["'][^"']*\bhd\b[^"']*["']/i.test(chunk)) return true;
  if (/>\s*HD\s*</i.test(chunk)) return true;
  if (/>\s*SD\s*</i.test(chunk)) return false;
  return null;
}

export function cleanTitle(value: string): string {
  return stripTags(value)
    .replace(/\s*[-–|]\s*pornhub(?:\.com)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Highest search page number the pagination block links to. */
function totalPagesFrom(html: string): number | null {
  let max = 0;
  for (const match of html.matchAll(/[?&]page=(\d{1,5})/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max > 0 ? max : null;
}

/**
 * Every distinct video card on one search page, in page order.
 *
 * A card may be linked twice (poster anchor and title anchor); both carry the
 * same viewkey, so the second occurrence simply fills whatever the first one
 * lacked.
 */
export function parseSearchListing(html: string, pageUrl: string = PORNHUB_BASE_URL): PornhubListing {
  const starts = cardStarts(html);
  const byKey = new Map<string, PornhubCard>();
  let hdSignal = /\bhd-thumbnail\b|data-hd\s*=\s*["']1["']/i.test(html);

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const chunk = cardChunk(html, start.index, starts[index + 1]?.index ?? null);
    const title = titleFromChunk(chunk);
    const thumbnailUrl = thumbnailFromChunk(chunk, pageUrl);
    const durationSeconds = durationFromChunk(chunk);
    const hd = hdFromChunk(chunk);
    const views = viewsFromChunk(chunk);

    const existing = byKey.get(start.viewkey);
    if (!existing) {
      byKey.set(start.viewkey, {
        viewkey: start.viewkey,
        title,
        thumbnailUrl,
        durationSeconds,
        views,
        hd,
        sourceUrl: watchUrlFor(start.viewkey),
      });
      continue;
    }
    if (!existing.title && title) existing.title = title;
    if (!existing.thumbnailUrl && thumbnailUrl) existing.thumbnailUrl = thumbnailUrl;
    if (existing.durationSeconds == null && durationSeconds != null) {
      existing.durationSeconds = durationSeconds;
    }
    if (existing.hd == null && hd != null) existing.hd = hd;
    if (existing.views == null && views != null) existing.views = views;
  }

  if (!hdSignal) hdSignal = [...byKey.values()].some((card) => card.hd === true);

  // A card without a title is a navigation or tracking link, not a video. A
  // title shorter than three characters is markup noise.
  const cards = [...byKey.values()].filter((card) => card.title.length >= 3);

  return { cards, totalPages: totalPagesFrom(html), hdSignal };
}

/** Tallest quality the detail page advertises, in pixels. */
export function maxQualityHeight(html: string): number | null {
  let max: number | null = null;
  const consider = (value: number) => {
    if (!Number.isFinite(value) || value < 240 || value > 4320) return;
    if (max == null || value > max) max = value;
  };

  for (const match of html.matchAll(/"quality"\s*:\s*"?(\d{3,4})"?/gi)) consider(Number(match[1]));
  for (const match of html.matchAll(/"videoHeight"\s*:\s*(\d{3,4})/gi)) consider(Number(match[1]));
  for (const match of html.matchAll(/<meta\b[^>]*property\s*=\s*["']og:video:height["'][^>]*>/gi)) {
    const value = Number(attribute(match[0], "content"));
    if (Number.isFinite(value)) consider(value);
  }
  return max;
}

/** Title, poster, duration and quality of a Pornhub watch page. */
export function parseVideoPage(
  html: string,
  viewkey: string,
  pageUrl: string = watchUrlFor(viewkey),
): PornhubDetail | null {
  if (!viewkey) return null;

  const ogTitle = html.match(/<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*>/i)?.[0];
  const title = cleanTitle(
    (ogTitle ? attribute(ogTitle, "content") : "") ||
      firstOf(html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i]) ||
      "",
  );
  if (!title) return null;

  const ogImage = html.match(/<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i)?.[0];
  const ogDescription = html.match(
    /<meta\b[^>]*property\s*=\s*["']og:description["'][^>]*>/i,
  )?.[0];
  const durationMeta = attribute(
    html.match(/<meta\b[^>]*property\s*=\s*["']video:duration["'][^>]*>/i)?.[0] || "",
    "content",
  );
  const durationJson = /"video_duration"\s*:\s*"([^"]+)"/i.exec(html)?.[1];

  return {
    viewkey,
    title,
    description: ogDescription
      ? stripTags(attribute(ogDescription, "content") || "").slice(0, 1200) || null
      : null,
    thumbnailUrl: ogImage
      ? normalizeThumbnail(attribute(ogImage, "content"))
      : normalizeThumbnail(/https?:\/\/[^\s"'<>\\]+?phncdn\.com[^\s"'<>\\]*\.jpg/i.exec(html)?.[0]),
    durationSeconds: parseDuration(durationMeta) ?? parseDuration(durationJson ?? null),
    maxHeight: maxQualityHeight(html),
    sourceUrl: pageUrl,
  };
}

/** Stable, collision-resistant catalog slug for an imported video. */
export function pornhubSlug(title: string, viewkey: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return `${base || "video"}-${viewkey.toLowerCase()}`;
}
