import { isReadyMediaFile } from "./parse";

/**
 * Confirm a catalog destination is a real video *before* a visitor opens it.
 *
 * Import already parsed a file URL from the post page. Hitting the host here
 * (a few kilobytes, not the film) follows any CDN redirect and refuses HTML
 * block pages, so `playable_url` is the address the watch page can put on
 * `<video src>` with no extra discovery.
 */

export type FetchHostMedia = (url: string) => Promise<string | null>;

const PAGE_REFERER = "https://www.damplips.com/";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** First kilobyte is enough to learn the content type and the final URL. */
const RANGE = "bytes=0-1023";
const DEFAULT_TIMEOUT_MS = 8_000;

function looksLikeVideo(contentType: string | null): boolean {
  const type = (contentType || "").toLowerCase();
  if (!type) return true;
  if (type.startsWith("video/")) return true;
  if (type.includes("mpegurl") || type.includes("application/vnd.apple.mpegurl")) return false;
  return type.includes("octet-stream") || type.includes("mp4");
}

export async function fetchHostMediaUrl(
  url: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string | null> {
  if (!isReadyMediaFile(url)) return null;
  const fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) return null;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Range: RANGE,
        Referer: PAGE_REFERER,
        "User-Agent": USER_AGENT,
        Accept: "video/mp4,video/*,*/*;q=0.8",
      },
      signal: controller,
    });
    if (!response.ok && response.status !== 206) return null;
    if (!looksLikeVideo(response.headers.get("content-type"))) return null;
    const finalUrl = (response.url || url).split("#")[0];
    return finalUrl || url;
  } catch {
    return null;
  }
}
