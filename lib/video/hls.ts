/**
 * HLS manifest handling for the same-origin media proxy.
 *
 * A damplips post often publishes an `.m3u8` playlist instead of a single
 * `.mp4`. A playlist is a *document*, not a media file: every segment, key and
 * nested playlist it names is fetched separately by the player, and those
 * requests never pass through `?src=`. If a segment URI is relative it would be
 * resolved against our proxy route (`/api/videos/stream`) and 404; if it is
 * absolute the browser would fetch damplips directly and be stopped by CORS.
 *
 * Both cases produce the same unhelpful "video could not be loaded" state, so
 * the proxy rewrites every URI in the playlist into a proxy URL of its own.
 * Everything here is a pure function over text so it can be unit-tested.
 */

/** Playlist MIME types damplips hosts serve. */
const HLS_CONTENT_TYPE =
  /^(application\/(?:vnd\.apple\.mpegurl|x-mpegurl|mpegurl)|audio\/(?:x-)?mpegurl)$/i;

const HLS_PATH = /\.m3u8(?:[?#]|$)/i;

export function isHlsContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const value = contentType.split(";")[0]?.trim() || "";
  return HLS_CONTENT_TYPE.test(value);
}

export function isHlsUrl(url: string): boolean {
  return HLS_PATH.test(url);
}

/** An HTML document — a post page, not media. */
const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)$/i;

export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const value = contentType.split(";")[0]?.trim() || "";
  return HTML_CONTENT_TYPE.test(value);
}

/** `URI="…"` carries keys, maps, renditions and nested variant playlists. */
const URI_ATTRIBUTE = /(\bURI\s*=\s*")([^"]*)(")/gi;

function isFetchable(uri: string): boolean {
  return /^https?:/i.test(uri);
}

/**
 * Rewrites a playlist so every URI it names goes through `toProxy`.
 *
 * `toProxy` returns the replacement URL, or `null` when the URI must be left
 * alone (a host the proxy refuses to fetch). Every relative URI is first
 * resolved against the playlist's own address, so the player never has to guess
 * where a segment lives.
 */
export function rewriteHlsPlaylist(
  text: string,
  playlistUrl: string,
  toProxy: (absoluteUrl: string) => string | null,
): string {
  const rewriteUri = (raw: string): string | null => {
    const value = raw.trim();
    if (!value) return null;
    let absolute: URL;
    try {
      absolute = new URL(value, playlistUrl);
    } catch {
      return null;
    }
    if (!isFetchable(absolute.toString())) return null;
    const proxied = toProxy(absolute.toString());
    if (!proxied) return null;
    // Fragments never reach a server; keeping them out prevents the proxy from
    // treating `#t=…` as part of the upstream query string.
    absolute.hash = "";
    return proxied;
  };

  // `\r\n` and `\n` playlists both exist; normalise on the way out.
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(URI_ATTRIBUTE, (match, before: string, value: string, after: string) => {
          const rewritten = rewriteUri(value);
          return rewritten ? `${before}${rewritten}${after}` : match;
        });
      }
      const rewritten = rewriteUri(trimmed);
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      return rewritten ? `${indent}${rewritten}` : line;
    })
    .join("\n");
}
