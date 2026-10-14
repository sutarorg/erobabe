export function bunnyEmbedUrl(libraryId: string, videoId: string): string {
  if (
    !/^[1-9]\d*$/.test(libraryId) ||
    !Number.isSafeInteger(Number(libraryId)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      videoId,
    )
  )
    throw new Error("Invalid Bunny playback identity");
  return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`;
}
/** Stored direct media and embeds only. No retired-provider API calls or URL fabrication. */
export type PlaybackSource =
  | { kind: "direct" | "embed"; url: string }
  | { kind: "missing" | "unsupported" };
export function selectPlaybackSource(
  playableUrl?: string | null,
  embedUrl?: string | null,
  provider?: string | null,
  libraryId?: string | null,
  videoId?: string | null,
): PlaybackSource {
  if (provider === "streamtape") return { kind: "unsupported" };
  if (["archived", "ufoload", "uqload"].includes(provider || ""))
    return { kind: "unsupported" };
  if (provider === "bunny") {
    try {
      const expected = bunnyEmbedUrl(libraryId || "", videoId || "");
      if (embedUrl !== expected) return { kind: "missing" };
      return { kind: "embed", url: expected };
    } catch {
      return { kind: "missing" };
    }
  }
  if (
    provider &&
    !["direct_url", "internal", "s3", "cloudflare", "embed"].includes(provider)
  )
    return { kind: "unsupported" };
  for (const [raw, kind] of [
    [playableUrl, "direct"],
    [embedUrl, "embed"],
  ] as const) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password)
        continue;
      // These historic records cannot be refreshed safely after retiring the API.
      if (
        /(^|\.)(streamtape\.(com|net|to)|tapecontent\.net)$/i.test(url.hostname)
      )
        return { kind: "unsupported" };
      if (kind === "embed") {
        // Preserve well-defined historical players, never arbitrary iframe origins.
        const approved =
          (["www.youtube-nocookie.com", "www.youtube.com"].includes(
            url.hostname,
          ) &&
            /^\/embed\/[A-Za-z0-9_-]+$/.test(url.pathname)) ||
          (url.hostname === "player.vimeo.com" &&
            /^\/video\/\d+$/.test(url.pathname));
        if (!approved || url.protocol !== "https:" || url.port)
          return { kind: "unsupported" };
      }
      return { kind, url: url.toString() };
    } catch {
      /* Invalid stored data must not become an executable iframe. */
    }
  }
  return { kind: "missing" };
}
