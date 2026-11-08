/**
 * damplips.com HTML parsing.
 *
 * The importer never copies media: it reads damplips' public listing and post
 * pages and keeps only the metadata a card needs (title, thumbnail, duration)
 * plus the media destination the page itself advertises. Everything here is a
 * pure function over HTML so it can be unit-tested without the network.
 */

/** Base site; the importer may be pointed at a mirror for testing. */
export const DAMPLIPS_BASE_URL = "https://www.damplips.com";

export type DamplipsCard = {
  /** damplips post id (`/p/<id>/`). Stable external identity. */
  sourceId: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl: string | null;
};

export type DamplipsMedia = { kind: "direct" | "embed"; url: string };

export type DamplipsDetail = {
  sourceId: string;
  sourceUrl: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  /** Tallest rendition the page advertises (1080, 720, …), or null. */
  maxHeight: number | null;
  /** Views the page advertises, when it prints one. */
  views: number | null;
  /**
   * damplips taxonomy slugs the post files itself under (`/c/<slug>/` links it
   * marks as categories, `article:section`, JSON-LD `genre`). This is how the
   * importer decides whether the post belongs to the erobabe category it was
   * found through, or should be catalogued with no category at all.
   */
  categorySlugs: string[];
  /** Tags/keywords the post prints, matched against the category's own words. */
  tags: string[];
  /** Other post ids this page links to — the related-video frontier. */
  relatedIds: string[];
  media: DamplipsMedia | null;
};

/**
 * Advertisement, analytics and asset hosts that appear next to the real media
 * URL. A video URL is never taken from these; they are referrals and banners.
 */
const BLOCKED_MEDIA_HOSTS = [
  "adtng.com",
  "brazzersnetwork.com",
  "brokensluts.net",
  "juicyads.com",
  "exoclick.com",
  "exosrv.com",
  "trafficjunky.net",
  "trafficfactory.biz",
  "doubleclick.net",
  "googletagmanager.com",
  "google-analytics.com",
  "googlesyndication.com",
  "cloudflareinsights.com",
  "gravatar.com",
  "w.org",
  "schema.org",
  "wordpress.org",
];

/** Players that may be framed as an embed when damplips publishes one. */
const APPROVED_EMBED_HOSTS = ["damplips.com", "youtube.com", "youtube-nocookie.com", "vimeo.com"];

const FILE_EXTENSION = /\.(mp4|m4v|webm)(?:[?#]|$)/i;
const MEDIA_EXTENSION = /\.(mp4|m4v|webm|m3u8)(?:[?#]|$)/i;

/**
 * A URL the watch page can put on `<video src>` with no extra discovery.
 *
 * HLS playlists and damplips post pages still have to be turned into a file at
 * request time; those are prepared at import instead, or skipped.
 */
export function isReadyMediaFile(url: string): boolean {
  if (FILE_EXTENSION.test(url)) return true;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("damplips.com")) return false;
    if (/\.m3u8(?:[?#]|$)/i.test(parsed.pathname)) return false;
    return /\/videos?\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

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

/** Origin a page was served from, so a mirror (or a test fixture) keeps working. */
function originOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return DAMPLIPS_BASE_URL;
  }
}

function hostOf(value: string, base = DAMPLIPS_BASE_URL): string | null {
  try {
    return new URL(value, base).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHost(host: string | null): boolean {
  if (!host) return true;
  return BLOCKED_MEDIA_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function isApprovedEmbedHost(host: string | null): boolean {
  if (!host) return false;
  return APPROVED_EMBED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Absolute, credential-free http(s) URL, or null. */
export function toSafeUrl(value: string | null | undefined, base = DAMPLIPS_BASE_URL): string | null {
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

/** damplips post id from any `/p/<id>/` URL or path. */
export function postIdFromUrl(value: string): string | null {
  const match = /\/p\/(\d+)(?:[/?#]|$)/i.exec(value);
  if (!match) return null;
  return match[1];
}

/**
 * A poster URL a card can actually paint.
 *
 * `og:image` is usually the post's poster, but themes also point it at a
 * placeholder, a GIF or a tracking pixel. A value that is not an image file on
 * an http(s) host is refused here, so the poster repair below knows a row really
 * has no usable picture.
 */
export function bestPoster(value: string | null | undefined): string | null {
  const url = toSafeUrl(value ?? "");
  if (!url) return null;
  if (/\.(gif|svg)(?:[?#]|$)/i.test(url)) return null;
  return url;
}

/** True when a stored value is a poster the grid can display. */
export function looksLikePoster(value: string | null | undefined): boolean {
  const url = bestPoster(value);
  if (!url) return false;
  try {
    return /\.(jpe?g|png|webp|avif)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function bestImageFrom(html: string): string | null {
  const images = html.match(/<img\b[^>]*>/gi) || [];
  for (const image of images) {
    for (const name of ["data-src", "data-original", "data-lazy-src", "src"]) {
      const candidate = toSafeUrl(attribute(image, name));
      if (candidate && !/\.(gif|svg)(?:[?#]|$)/i.test(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Every distinct video card on a listing page, in page order.
 *
 * Listing pages link the same post twice (a thumbnail anchor and a title
 * anchor), so cards are merged by post id: the first anchor with a real title
 * wins, and a missing thumbnail is filled from a later anchor for the same id.
 */
export function parseListing(html: string, pageUrl = DAMPLIPS_BASE_URL): {
  cards: DamplipsCard[];
  nextPageUrl: string | null;
} {
  const byId = new Map<string, DamplipsCard>();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    const attributes = match[1] || "";
    const href = toSafeUrl(attribute(attributes, "href"), pageUrl);
    if (!href) continue;
    const sourceId = postIdFromUrl(href);
    if (!sourceId) continue;

    const title =
      attribute(attributes, "title") ||
      stripTags(match[2] || "") ||
      attribute((match[2] || "").match(/<img\b[^>]*>/i)?.[0] || "", "alt") ||
      "";
    const thumbnail =
      bestImageFrom(match[2] || "") ||
      bestImageFrom(html.slice(Math.max(0, match.index - 600), match.index));

    const existing = byId.get(sourceId);
    if (!existing) {
      byId.set(sourceId, {
        sourceId,
        sourceUrl: `${originOf(pageUrl)}/p/${sourceId}/`,
        title: cleanTitle(title),
        thumbnailUrl: thumbnail,
      });
      continue;
    }
    if (!existing.title) existing.title = cleanTitle(title);
    if (!existing.thumbnailUrl) existing.thumbnailUrl = thumbnail;
  }

  const cards = [...byId.values()]
    .filter((card) => card.title.length >= 8)
    // Navigation and tracking anchors are not videos; a card without a poster
    // or a title long enough to be a listing headline is dropped.
    .filter((card) => card.thumbnailUrl !== null || card.title.length >= 12);

  return { cards, nextPageUrl: parseNextPageUrl(html, pageUrl) };
}

function cleanTitle(value: string): string {
  return stripTags(value)
    .replace(/\s*[-–|]\s*(damplips|naked girls)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** `rel="next"`, `<link rel=next>`, or a pagination `Next` anchor. */
export function parseNextPageUrl(html: string, pageUrl = DAMPLIPS_BASE_URL): string | null {
  const candidates = [
    /<link\b[^>]*\brel\s*=\s*["']next["'][^>]*>/i.exec(html)?.[0],
    html.match(/<a\b[^>]*class\s*=\s*["'][^"']*\bnext\b[^"']*["'][^>]*>/i)?.[0],
    html.match(/<a\b[^>]*rel\s*=\s*["']next["'][^>]*>/i)?.[0],
  ];
  for (const tag of candidates) {
    if (!tag) continue;
    const href = toSafeUrl(attribute(tag, "href"), pageUrl);
    if (!href) continue;
    const host = hostOf(href, pageUrl);
    const baseHost = hostOf(pageUrl);
    if (!host || !baseHost) continue;
    if (host !== baseHost && !host.endsWith(`.${baseHost.replace(/^www\./, "")}`)) continue;
    return href;
  }
  return null;
}

/**
 * Next page of a damplips search listing when the HTML has no `rel=next`.
 *
 * WordPress serves `/?s=amateur` then `/?s=amateur&paged=2`. The importer
 * stops as soon as a page has no new cards.
 */
export function advanceSearchPage(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (!url.searchParams.has("s")) return null;
    const current = Number(url.searchParams.get("paged") || "1");
    if (!Number.isFinite(current) || current < 1) return null;
    url.searchParams.set("paged", String(Math.floor(current) + 1));
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The next page of any damplips listing.
 *
 * `rel=next` wins when the theme prints it. A search falls back to
 * `?s=term&paged=N`. A path listing (`/c/milf/`, `/most-popular/`) falls back to
 * the theme's own `/page/N/` shape, which is what WordPress archives use.
 */
export function nextListingPage(pageUrl: string, html: string): string | null {
  const declared = parseNextPageUrl(html, pageUrl);
  if (declared) return declared;

  const search = advanceSearchPage(pageUrl);
  if (search) return search;

  try {
    const url = new URL(pageUrl);
    const match = /^(.*?)\/page\/(\d+)\/?$/.exec(url.pathname);
    const basePath = (match ? match[1] : url.pathname.replace(/\/$/, "")) || "";
    const nextPage = match ? Number(match[2]) + 1 : 2;
    if (!Number.isFinite(nextPage) || nextPage > 5_000) return null;
    url.pathname = `${basePath}/page/${nextPage}/`;
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Tallest quality a post page advertises, in pixels. */
export function maxQualityHeight(html: string): number | null {
  let max: number | null = null;
  const consider = (value: number) => {
    if (!Number.isFinite(value) || value < 240 || value > 4320) return;
    if (max == null || value > max) max = value;
  };

  for (const match of html.matchAll(/"height"\s*:\s*"?(\d{3,4})"?/gi)) consider(Number(match[1]));
  for (const match of html.matchAll(/<meta\b[^>]*property\s*=\s*["']og:video:height["'][^>]*>/gi)) {
    consider(Number(attribute(match[0], "content")));
  }
  for (const match of html.matchAll(/\b(2160|1440|1080|720|480|360)p\b/g)) consider(Number(match[1]));
  return max;
}

/** A view counter as a number: `1,204`, `12K`, `1.4M`. */
export function parseViews(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim().replace(/\u00a0/g, " ");
  if (!text) return null;

  const match = /([\d][\d.,\s]*)\s*([kKmMbB])?/.exec(text);
  if (!match) return null;
  const magnitude = match[2]
    ? ({ k: 1_000, m: 1_000_000, b: 1_000_000_000 } as const)[
        match[2].toLowerCase() as "k" | "m" | "b"
      ]
    : 1;
  const raw = match[1].replace(/\s/g, "");
  const digits = magnitude > 1 ? raw.replace(/,/g, ".") : raw.replace(/[.,]/g, "");
  const numeric =
    magnitude > 1 ? Number(digits.split(".").slice(0, 2).join(".")) : Number(digits);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const total = Math.round(numeric * magnitude);
  return total > 0 && total < 1_000_000_000_000 ? total : null;
}

function viewsFromPage(html: string): number | null {
  const patterns = [
    /"views"\s*:\s*"?([\d.,]+\s*[KkMmBb]?)"?/i,
    /\b([\d][\d.,]*\s*[KkMmBb]?)\s*(?:views|view)\b/i,
  ];
  for (const pattern of patterns) {
    const value = parseViews(pattern.exec(stripTags(html))?.[1] ?? pattern.exec(html)?.[1] ?? null);
    if (value != null) return value;
  }
  return null;
}

/** `PT12M34S`, `00:12:34`, `754` → seconds. */
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

  if (/^\d+(\.\d+)?$/.test(text)) {
    const seconds = Math.round(Number(text));
    return seconds > 0 && seconds < 86_400 ? seconds : null;
  }

  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock) {
    const parts = clock[3]
      ? [Number(clock[1]), Number(clock[2]), Number(clock[3])]
      : [0, Number(clock[1]), Number(clock[2])];
    const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    return seconds > 0 ? seconds : null;
  }
  return null;
}

function collectMediaCandidates(html: string, pageUrl: string): DamplipsMedia[] {
  // damplips publishes its player as server-rendered markup
  // (`<video class="video-js"><source src="https://video.damplips.com/video7/…">`),
  // but players configured from JavaScript carry the same URL with escaped
  // slashes. Scanning an unescaped copy of the document as well is what lets
  // those posts import instead of being skipped as "no media".
  const scan = html.includes("\\/") || /\\u002f/i.test(html)
    ? html.replace(/\\\//g, "/").replace(/\\u002[fF]/g, "/")
    : html;

  const candidates: DamplipsMedia[] = [];
  const push = (declared: "direct" | "embed", raw: string | null | undefined) => {
    const url = toSafeUrl(raw ?? "", pageUrl);
    if (!url) return;
    // A URL that names a player path is an embed whatever attribute it came
    // from: `og:video:url` is sometimes the framed player, not a file.
    const kind: "direct" | "embed" = /\/(?:embed|player|e)\/[^/]/i.test(url) ? "embed" : declared;
    const host = hostOf(url, pageUrl);
    if (isBlockedHost(host)) return;
    if (kind === "direct" && !MEDIA_EXTENSION.test(url) && !/\/videos?\//i.test(url)) {
      // A direct source without a media extension is almost always an image or
      // a script; only trust it when it lives on the damplips media host.
      if (!host?.endsWith("damplips.com")) return;
    }
    if (kind === "embed" && !isApprovedEmbedHost(host)) return;
    if (!candidates.some((candidate) => candidate.url === url)) candidates.push({ kind, url });
  };

  // 1. Open Graph / video meta tags (the page's own claim about its player).
  for (const tag of scan.match(/<meta\b[^>]*>/gi) || []) {
    const property = (attribute(tag, "property") || attribute(tag, "name") || "").toLowerCase();
    if (!property.startsWith("og:video") && property !== "twitter:player:stream") continue;
    const content = attribute(tag, "content");
    push(property.includes("embed") || property.includes("player") ? "embed" : "direct", content);
  }

  // 2. JSON-LD VideoObject.
  for (const block of scan.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []) {
    const contentUrl = /"contentUrl"\s*:\s*"([^"]+)"/i.exec(block)?.[1];
    const embedUrl = /"embedUrl"\s*:\s*"([^"]+)"/i.exec(block)?.[1];
    push("direct", contentUrl);
    push("embed", embedUrl);
  }

  // 3. HTML5 media elements.
  for (const element of scan.match(/<(?:video|source)\b[^>]*>/gi) || []) {
    push("direct", attribute(element, "src"));
    push("direct", attribute(element, "data-src"));
  }

  // 4. Player configuration (videojs, jwplayer, plyr, flowplayer, wp themes).
  //    A player path is an embed, not a file, even when it is written in a
  //    `src=` attribute.
  for (const match of scan.matchAll(/(?:file|src|source|video_url|videoUrl|hls)\s*[:=]\s*["']([^"']+)["']/gi)) {
    const value = match[1];
    push(/\/(?:embed|player|e)\/[^/]/i.test(value) ? "embed" : "direct", value);
  }
  for (const match of scan.matchAll(/["'](https?:\/\/[^"'\s]+?\.(?:mp4|m4v|webm|m3u8))["']/gi)) {
    push("direct", match[1]);
  }

  // 5. Explicit data-* media attributes some themes and lazy players use.
  for (const match of scan.matchAll(/data-(?:video-?(?:src|file|url|mp4|hls)|mp4|hls)\s*=\s*["']([^"']+)["']/gi)) {
    push(/\/(?:embed|player|e)\/[^/]/i.test(match[1]) ? "embed" : "direct", match[1]);
  }

  // 6. Schema.org microdata.
  for (const tag of scan.match(/<(?:meta|link)\b[^>]*>/gi) || []) {
    const key = (attribute(tag, "itemprop") || attribute(tag, "rel") || "").toLowerCase();
    if (key === "contenturl") push("direct", attribute(tag, "content") || attribute(tag, "href"));
    if (key === "embedurl") push("embed", attribute(tag, "content") || attribute(tag, "href"));
  }

  // 7. Any absolute media file URL in the page, quoted or not.
  for (const match of scan.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m4v|webm|m3u8)(?:\?[^\s"'<>\\]*)?/gi)) {
    push("direct", match[0]);
  }

  // 8. A framed player damplips explicitly publishes.
  for (const iframe of scan.match(/<iframe\b[^>]*>/gi) || []) {
    push("embed", attribute(iframe, "src") || attribute(iframe, "data-src"));
  }

  // Only ready files: import stores a URL the watch player can stream with no
  // extra discovery. Playlists and embeds are not catalog destinations.
  return candidates.filter(
    (candidate) => candidate.kind === "direct" && isReadyMediaFile(candidate.url),
  );
}

/** The best ready file a post page offers, or none. */
export function parseMedia(html: string, pageUrl = DAMPLIPS_BASE_URL): DamplipsMedia | null {
  return collectMediaCandidates(html, pageUrl)[0] ?? null;
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) continue;
    const value = stripTags(match[1] || "");
    if (value) return value;
  }
  return null;
}

/** Title, poster, duration and media destination of a damplips post page. */
export function parseVideoPage(html: string, pageUrl: string): DamplipsDetail | null {
  const sourceId = postIdFromUrl(pageUrl) || postIdFromUrl(toSafeUrl(pageUrl) || "");
  if (!sourceId) return null;

  const ogTitleTag = html.match(/<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*>/i)?.[0];
  const title = cleanTitle(
    firstMatch(html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i]) ||
      (ogTitleTag ? attribute(ogTitleTag, "content") : "") ||
      "",
  );
  if (!title) return null;

  const ogImageTag = html.match(/<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i)?.[0];
  const description =
    stripTags(
      html.match(/<meta\b[^>]*property\s*=\s*["']og:description["'][^>]*>/i)?.[0]
        ? attribute(html.match(/<meta\b[^>]*property\s*=\s*["']og:description["'][^>]*>/i)![0], "content") || ""
        : "",
    ) || null;

  const durationSeconds = parseDuration(
    attribute(html.match(/<meta\b[^>]*property\s*=\s*["']video:duration["'][^>]*>/i)?.[0] || "", "content") ??
      /"duration"\s*:\s*"([^"]+)"/i.exec(html)?.[1] ??
      html.match(/<span\b[^>]*class\s*=\s*["'][^"']*duration[^"']*["'][^>]*>([^<]+)</i)?.[1] ??
      null,
  );

  const signals = postCategorySignals(html);

  return {
    sourceId,
    sourceUrl: `${originOf(pageUrl)}/p/${sourceId}/`,
    title,
    description: description ? description.slice(0, 1200) : null,
    thumbnailUrl: ogImageTag
      ? bestPoster(attribute(ogImageTag, "content")) || bestImageFrom(html)
      : bestImageFrom(html),
    durationSeconds,
    maxHeight: maxQualityHeight(html),
    views: viewsFromPage(html),
    categorySlugs: signals.categorySlugs,
    tags: signals.tags,
    relatedIds: relatedPostIds(html, sourceId),
    media: parseMedia(html, pageUrl),
  };
}

/**
 * The taxonomy a post page files itself under, plus its tags.
 *
 * A site-wide navigation menu links every category too, so anchors only count
 * when WordPress marks them as the post's own (`rel="category tag"` /
 * `rel="tag"`); the menu cannot accidentally make every post look like it
 * belongs everywhere. `article:section`, `keywords` and JSON-LD `genre` are the
 * same claim in machine-readable form.
 */
export function postCategorySignals(html: string): {
  categorySlugs: string[];
  tags: string[];
} {
  const categorySlugs = new Set<string>();
  const tags = new Set<string>();

  const seenTags = new Set<string>();
  const addTag = (value: string) => {
    const tag = stripTags(value);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seenTags.has(key)) return;
    seenTags.add(key);
    tags.add(tag);
  };
  const addWords = (value: string) => {
    for (const part of value.split(/[,|]/)) addTag(part);
  };

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attribute(tag, "property") || attribute(tag, "name") || "").toLowerCase();
    const content = attribute(tag, "content");
    if (!content) continue;
    if (key === "article:section" || key === "keywords" || key === "article:tag") addWords(content);
  }

  for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    const rel = (attribute(anchor, "rel") || "").toLowerCase();
    if (!rel.includes("category") && !rel.includes("tag")) continue;
    const href = attribute(anchor, "href");
    const slug = href ? /\/c\/([a-z0-9-]+)\/?/i.exec(href)?.[1] : undefined;
    if (slug) {
      const normalised = slug.toLowerCase();
      categorySlugs.add(normalised);
      // The slug already says it; the visible label would only repeat it.
      if (normalised.split("-").join(" ") !== stripTags(anchor.replace(/^<a\b[^>]*>/i, "")).toLowerCase()) {
        addTag(anchor.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, ""));
      }
      continue;
    }
    addTag(anchor.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, ""));
  }

  for (const block of html.match(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ) || []) {
    for (const match of block.matchAll(/"genre"\s*:\s*(?:\[([^\]]*)\]|"([^"]+)")/gi)) {
      for (const value of [match[1], match[2]]) {
        if (!value) continue;
        for (const part of value.matchAll(/"([^"]+)"/g)) addWords(part[1]);
      }
    }
  }

  return { categorySlugs: [...categorySlugs], tags: [...tags] };
}

/**
 * Every other post id a page links to.
 *
 * Post pages carry a related-videos block, and those links are new post ids the
 * importer has not seen on any listing. They are what keeps a long run finding
 * videos after the listings themselves have been walked.
 */
export function relatedPostIds(html: string, selfId?: string | null): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(/\/p\/(\d+)(?:[/?#"'<\s]|$)/gi)) {
    const id = String(match[1]);
    if (selfId && id === String(selfId)) continue;
    ids.add(id);
  }
  return [...ids];
}

/**
 * Category links on a damplips page, keyed by lower-case slug, so the importer
 * can verify that a category path exists before paging through it.
 */
export function parseCategoryLinks(html: string, pageUrl = DAMPLIPS_BASE_URL): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']*\/c\/([a-z0-9-]+)\/?)["']/gi)) {
    const url = toSafeUrl(match[1], pageUrl);
    if (!url) continue;
    const slug = String(match[2] || "").toLowerCase();
    if (slug && !found.has(slug)) found.set(slug, url);
  }
  return found;
}

/** Stable, collision-resistant catalog slug for an imported post. */
export function damplipsSlug(title: string, sourceId: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return `${base || "video"}-${sourceId}`;
}
