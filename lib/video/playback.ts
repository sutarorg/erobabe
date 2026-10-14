/** Shared, browser-safe playback selection. Never load Streamtape's ad player. */
const STREAMTAPE_HOST = /(^|\.)streamtape\.(com|net|to)$/i;

export function streamtapeFileId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || !STREAMTAPE_HOST.test(url.hostname)) return null;
    return url.pathname.match(/^\/(?:e|v|d)\/([a-z0-9]+)(?:\/|$)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export type PlaybackSource =
  | { kind: "direct" | "embed"; url: string }
  | { kind: "streamtape"; fileId: string | null }
  | { kind: "missing" };

export function selectPlaybackSource(playableUrl?: string | null, embedUrl?: string | null): PlaybackSource {
  for (const [raw, kind] of [[playableUrl, "direct"], [embedUrl, "embed"]] as const) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
      const fileId = streamtapeFileId(raw);
      // Also catch legacy watch pages mistakenly saved in playable_url.
      if (fileId || (kind === "embed" && STREAMTAPE_HOST.test(url.hostname))) {
        return { kind: "streamtape", fileId };
      }
      return { kind, url: url.toString() };
    } catch {
      // Invalid legacy data must not become an executable iframe URL.
    }
  }
  return { kind: "missing" };
}

/** API output is media only, not an arbitrary URL or a credential-bearing API request. */
export function safeStreamtapeMediaUrl(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    !/(^|\.)(tapecontent\.net|streamtape\.(com|net|to))$/i.test(url.hostname) ||
    url.hostname.toLowerCase().startsWith("api.") ||
    /^\/(?:e|v|d)(?:\/|$)/i.test(url.pathname) ||
    [...url.searchParams.keys()].some((key) => /^(login|key)$/i.test(key))
  ) {
    throw new Error("Invalid Streamtape media URL");
  }
  return url.toString();
}
