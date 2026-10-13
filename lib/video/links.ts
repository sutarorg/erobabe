/**
 * Pure helpers for turning whatever an admin pastes into a usable video
 * source.
 *
 * Admins copy links from all over the web, so the pasted text is rarely a bare
 * URL. It arrives wrapped in Markdown (`[label](https://host/file.mp4)`), in
 * angle brackets, as `<iframe …>` markup, with trailing punctuation, or as a
 * player page (Streamtape `/v/<id>/Name.mp4.ts.mp4`) instead of a media file.
 *
 * This module is deliberately free of Node-only imports: the admin upload page
 * (a client component), the API routes, and the unit tests all share it. URL
 * safety is re-checked server-side with `assertPublicHttpUrl` before anything
 * is stored.
 */

export type VideoSourceKind = "direct" | "embed";

export interface ClassifiedVideoSource {
  /** Normalised URL that can be stored as `playable_url` or `embed_url`. */
  url: string;
  /** `direct` plays in a native <video>; `embed` loads the host's player page in an iframe. */
  kind: VideoSourceKind;
  /** Lower-cased hostname, for logging and UI badges. */
  host: string;
  /** One-line explanation of what was detected, shown to the admin. */
  note: string;
}

/** Extensions we accept as a real media file. */
export const VIDEO_EXTENSIONS = [
  "mp4",
  "webm",
  "mov",
  "m4v",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "ts",
  "mpg",
  "mpeg",
  "3gp",
] as const;

const VIDEO_EXTENSION_PATTERN = new RegExp(`\\.(${VIDEO_EXTENSIONS.join("|")})$`, "i");

/**
 * Trailing characters that belong to the surrounding prose, not the URL.
 * A sentence ends `…video.mp4.` — the final dot is punctuation, not the path.
 */
const TRAILING_NOISE = /[)\]>,;'"“”‘’!?.]+$/;

/** `<iframe … src="…" …>` (or `srcdoc`-less single quotes / bare values). */
const IFRAME_SRC_PATTERN = /<iframe\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/i;

/** First http(s) URL inside arbitrary text. */
const BARE_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i;

/** A Markdown link: `[label](https://host/path)` — also `[label](<url> "title")`. */
function markdownTarget(raw: string): string | null {
  const match = raw.match(/\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/);
  if (!match?.[1]) return null;
  return match[1].replace(/^<|>$/g, "").trim() || null;
}

/** Removes Markdown emphasis and surrounding punctuation from a bare URL. */
function tighten(url: string): string {
  let value = url.trim();
  // `[https://x/y](https://x/y)` leaves a leading `[` when the label is a URL.
  value = value.replace(/^[[(<]+/, "");
  value = value.replace(TRAILING_NOISE, "");
  value = value.replace(/^<|>$/g, "");
  return value.replace(/&amp;/gi, "&").trim();
}

/** True when the pasted text contains `<iframe …>`. */
export function looksLikeIframeMarkup(raw: string): boolean {
  return /<iframe\b/i.test(String(raw || ""));
}

/** Extracts the `src` of the first `<iframe …>` in the pasted text. */
export function iframeSourceFrom(raw: string): string | null {
  const match = String(raw || "").match(IFRAME_SRC_PATTERN);
  const source = match?.[1] || match?.[2] || match?.[3] || "";
  return source ? tighten(source) : null;
}

/**
 * Extracts the URL a human pasted, whatever wrapper it arrived in:
 *
 * - `[label](https://host/file.mp4)` → `https://host/file.mp4`
 * - `<https://host/file.mp4>` → `https://host/file.mp4`
 * - `<iframe src="https://host/e/id" …></iframe>` → `https://host/e/id`
 * - `Watch it: https://host/file.mp4.` → `https://host/file.mp4`
 * - `https://host/file.mp4` → unchanged
 *
 * Returns an empty string when no URL is present.
 */
export function normalizePastedLink(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const fromIframe = iframeSourceFrom(text);
  if (fromIframe) return fromIframe;

  const fromMarkdown = markdownTarget(text);
  if (fromMarkdown) return tighten(fromMarkdown);

  const bare = text.match(BARE_URL_PATTERN);
  if (bare?.[0]) return tighten(bare[0]);

  // Not a URL at all (or a protocol-relative / relative link): hand the text
  // back untouched so the caller can report the real problem.
  return tighten(text);
}

/** True when the URL path ends in a media-file extension. */
export function isDirectVideoUrl(raw: string): boolean {
  try {
    const url = new URL(normalizePastedLink(raw));
    return VIDEO_EXTENSION_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Player-page hosts we recognise, with the host's own embed URL when the page
 * the admin copied is not the frameable one (Streamtape's `/v/<id>` watch page
 * is not; its `/e/<id>` player page is).
 */
function convertPlayerPage(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // Streamtape: /v/<fileId>/<name> → /e/<fileId>
  if (/(^|\.)streamtape\.(com|net)$/.test(host) || /(^|\.)streamtape\.to$/.test(host)) {
    const id = path.match(/^\/(?:v|e|d)\/([A-Za-z0-9]+)/)?.[1];
    if (id) return `https://${url.hostname}/e/${id}`;
  }

  // Uqload-style: /<id>/<name>.html or /embed-<id>.html
  if (/(^|\.)uqload\.(com|io|to|co|net)$/.test(host)) {
    const id = path.match(/\/embed-([A-Za-z0-9]+)\.html$/)?.[1] || path.match(/^\/([A-Za-z0-9]{10,})\//)?.[1];
    if (id) return `https://${url.hostname}/embed-${id}.html`;
  }

  // DoodStream-family: /d/<id> → /e/<id>
  if (/(^|\.)(dood\.(la|so|ws|pm|to)|d000d\.com|do7go\.com|ds2play\.com|doods\.pro)$/.test(host)) {
    const id = path.match(/^\/(?:d|e|f)\/([A-Za-z0-9]+)/)?.[1];
    if (id) return `https://${url.hostname}/e/${id}`;
  }

  return null;
}

/** Hosts whose pages are always iframes, never media files. */
const PLAYER_HOST_PATTERN =
  /(^|\.)(streamtape\.(com|net|to)|uqload\.(com|io|to|co|net)|dood\.(la|so|ws|pm|to)|d000d\.com|do7go\.com|ds2play\.com|voe\.sx|vidmoly\.(to|me)|vidoza\.net|filemoon\.(sx|to)|netu\.tv|ok\.ru|player\.twitch\.tv|drive\.google\.com)$/;

/** Path shapes that mean "player page", regardless of host. */
const PLAYER_PATH_PATTERN = /^\/(?:embed|embed-|player|player-|e|v|watch)\b/i;

/**
 * Decides how a pasted value must be published:
 *
 * - a real media file → `direct` (stored in `playable_url`, native player)
 * - a player/embed page → `embed` (stored in `embed_url`, iframe)
 *
 * Throws an actionable error when the value is neither, so the admin sees the
 * reason inline instead of a silent failure after the Gemini round-trip.
 */
export function classifyVideoSource(raw: unknown): ClassifiedVideoSource {
  const input = String(raw ?? "").trim();
  if (!input) throw new Error("Paste a video URL first");

  const normalized = normalizePastedLink(input);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`"${input.slice(0, 120)}" is not a valid http or https video URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Video links must use http or https");
  }

  const host = url.hostname.toLowerCase();

  if (PLAYER_HOST_PATTERN.test(host)) {
    const converted = convertPlayerPage(url);
    const target = converted || url.toString();
    return {
      url: target,
      kind: "embed",
      host,
      note:
        converted && converted !== url.toString()
          ? `Player page detected on ${host} — using its embed player`
          : `Player page detected on ${host} — published as an embed`,
    };
  }

  if (VIDEO_EXTENSION_PATTERN.test(url.pathname)) {
    return { url: url.toString(), kind: "direct", host, note: `Direct video file on ${host}` };
  }

  if (PLAYER_PATH_PATTERN.test(url.pathname)) {
    return { url: url.toString(), kind: "embed", host, note: `Embed player detected on ${host}` };
  }

  throw new Error(
    `"${normalized.slice(0, 120)}" is not a direct video file (it must end in ${VIDEO_EXTENSIONS.slice(0, 4)
      .map((extension) => `.${extension}`)
      .join(", ")}…) and it is not a recognised player page`
  );
}

/** Normalises a pasted link and fails loudly when there is no URL in it. */
export function extractLinkSource(raw: unknown): string {
  const source = normalizePastedLink(raw);
  if (!source) throw new Error("Paste a video URL or iframe embed code");
  return source;
}

/**
 * Normalises a value destined for `embed_url`.
 *
 * Known player pages are converted to their frameable URL (Streamtape
 * `/v/<id>` → `/e/<id>`); anything else — including hosts this module does not
 * know, such as an arbitrary provider's iframe — is passed through untouched so
 * the route's own public-URL validation decides.
 */
export function normalizeEmbedSource(raw: unknown): string {
  const source = extractLinkSource(raw);
  try {
    return classifyVideoSource(source).url;
  } catch {
    return source;
  }
}
