/**
 * Turning a damplips *post page* into the file it advertises — fast.
 *
 * Some catalog rows store the HTML post page (`/p/<id>/`) as their playable
 * URL instead of the media file. Playing one used to mean: fetch the page,
 * read up to half a megabyte of ad-heavy HTML, parse it, and only then start
 * fetching the video. That is the difference between a video that starts and a
 * video that "takes forever to load".
 *
 * Two things fix it here:
 *
 *  1. **Early exit.** The media URL is published in `<head>` (`og:video`,
 *     JSON-LD, the player config), so the body is read chunk by chunk and
 *     abandoned the moment a file is recognised — usually after a few
 *     kilobytes instead of hundreds. The connection is cancelled, not drained.
 *  2. **A shared resolution cache.** The page is resolved once per process and
 *     remembered for half an hour, with concurrent lookups for the same page
 *     collapsed into one request. Both the watch page and the stream proxy use
 *     the same cache, so the discovery cost is paid at most once.
 *
 * Server-only: `parseMedia` is pure, but this module is only ever called from
 * server code (a route handler and a server component).
 */

import { parseMedia } from "@/lib/damplips/parse";
import { isDamplipsPostPage } from "./playback";

/** Bytes read from a page before giving up. Was 512 KB; the media tag is early. */
export const PAGE_BYTE_CAP = 192 * 1024;
/** Extra bytes scanned after `</head>` in case the player is inline in the body. */
export const HEAD_PADDING = 16 * 1024;
/** How long a page → file answer is reused. */
export const RESOLUTION_TTL_MS = 30 * 60 * 1000;
const RESOLUTION_LIMIT = 500;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PAGE_REFERER = "https://www.damplips.com/";
const MAX_PAGE_REDIRECTS = 3;

const cache = new Map<string, { url: string; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

/** Resets the memo — used by tests. */
export function clearPageMediaCache(): void {
  cache.clear();
  inflight.clear();
}

function cacheKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function rememberPageMedia(pageUrl: string, mediaUrl: string, at = Date.now()): void {
  const key = cacheKey(pageUrl);
  cache.delete(key);
  if (cache.size >= RESOLUTION_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { url: mediaUrl, at });
}

export function recallPageMedia(pageUrl: string, at = Date.now()): string | null {
  const key = cacheKey(pageUrl);
  const hit = cache.get(key);
  if (!hit) return null;
  if (at - hit.at > RESOLUTION_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.url;
}

/** Drops a remembered answer — used when the file it named stopped working. */
export function forgetPageMedia(pageUrl: string): void {
  cache.delete(cacheKey(pageUrl));
}

/** The first playable file the accumulated HTML names, as an absolute https URL. */
function directMediaFrom(html: string, pageUrl: string): string | null {
  if (!html) return null;
  const media = parseMedia(html, pageUrl);
  if (!media || media.kind !== "direct") return null;
  try {
    const url = new URL(media.url, pageUrl);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Reads an already-open page response until it names a media file.
 *
 * The body is consumed incrementally and cancelled as soon as the file is
 * known, so a slow, 400 KB page costs only the bytes that came before the
 * player metadata.
 */
export async function readPageMedia(response: Response, pageUrl: string): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const media = directMediaFrom(await response.text(), pageUrl);
    return media;
  }

  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  let headEnd = -1;

  try {
    while (size < PAGE_BYTE_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });

      // The media tag is in the document head. Stop at the first hit instead
      // of waiting for the rest of an ad-laden page.
      const found = directMediaFrom(text, pageUrl);
      if (found) return found;

      if (headEnd === -1) {
        const index = text.indexOf("</head>");
        if (index !== -1) headEnd = index;
      }
      // Head is complete and the padding after it is scanned: nothing more to
      // learn without downloading the whole page.
      if (headEnd !== -1 && size >= headEnd + HEAD_PADDING) break;
    }
  } catch {
    /* Keep whatever arrived; a truncated page may still name its file. */
  } finally {
    void reader.cancel().catch(() => undefined);
  }

  return directMediaFrom(text + decoder.decode(), pageUrl);
}

/**
 * Waits at most `budgetMs` for a resolution.
 *
 * Used by the watch page: the server-rendered player must never be held behind
 * a slow third-party page, and the stream proxy can still resolve it later.
 */
export function resolveWithin(
  work: Promise<string | null>,
  budgetMs: number,
): Promise<string | null> {
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), budgetMs);
      // Node keeps a pending timer alive; the answer usually wins the race.
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    }),
  ]);
}

export type ResolvePageMediaOptions = {
  /** Milliseconds before the page request is abandoned. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Skip the cache (a remembered URL that stopped working). */
  fresh?: boolean;
};

/**
 * The media file a damplips post page advertises, or `null`.
 *
 * Returns `null` immediately for anything that is not a post page: a media URL
 * needs no resolution, and this must never add a round trip to a normal file.
 */
export async function resolvePageMedia(
  pageUrl: string,
  options: ResolvePageMediaOptions = {},
): Promise<string | null> {
  if (!isDamplipsPostPage(pageUrl)) return null;

  if (!options.fresh) {
    const remembered = recallPageMedia(pageUrl);
    if (remembered) return remembered;
  } else {
    forgetPageMedia(pageUrl);
  }

  const key = cacheKey(pageUrl);
  const pending = inflight.get(key);
  if (pending) return pending;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;

  const task = (async (): Promise<string | null> => {
    let current = pageUrl;
    for (let hop = 0; hop <= MAX_PAGE_REDIRECTS; hop += 1) {
      let response: Response;
      try {
        response = await fetchImpl(current, {
          redirect: "follow",
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
            referer: PAGE_REFERER,
          },
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch {
        return null;
      }
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location")) {
        try {
          current = new URL(response.headers.get("location")!, current).toString();
        } catch {
          return null;
        }
        continue;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return null;
      }
      const media = await readPageMedia(response, current);
      if (media) {
        rememberPageMedia(pageUrl, media);
        return media;
      }
      return null;
    }
    return null;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return task;
}
