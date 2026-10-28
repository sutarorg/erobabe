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

const MEDIA_EXTENSION = /\.(mp4|m4v|webm|m3u8)(?:[?#]|$)/i;

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
        sourceUrl: `${DAMPLIPS_BASE_URL}/p/${sourceId}/`,
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

  // Direct files first so import stores a ready-to-play URL (no watch-page
  // "Preparing" step). Playlists are last among direct sources; embeds after.
  const files = candidates.filter(
    (candidate) => candidate.kind === "direct" && !/\.m3u8(\?|$)/i.test(candidate.url),
  );
  const playlists = candidates.filter(
    (candidate) => candidate.kind === "direct" && /\.m3u8(\?|$)/i.test(candidate.url),
  );
  const embeds = candidates.filter((candidate) => candidate.kind === "embed");
  return [...files, ...playlists, ...embeds];
}

/** The best media destination a post page offers, prefering direct files. */
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

  return {
    sourceId,
    sourceUrl: `${DAMPLIPS_BASE_URL}/p/${sourceId}/`,
    title,
    description: description ? description.slice(0, 1200) : null,
    thumbnailUrl: ogImageTag ? toSafeUrl(attribute(ogImageTag, "content")) : bestImageFrom(html),
    durationSeconds,
    media: parseMedia(html, pageUrl),
  };
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
