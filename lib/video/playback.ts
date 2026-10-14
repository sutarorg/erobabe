/** Stored direct media and embeds only. No retired-provider API calls or URL fabrication. */
export type PlaybackSource =
  | { kind: "direct" | "embed"; url: string }
  | { kind: "missing" | "unsupported" };
export function selectPlaybackSource(
  playableUrl?: string | null,
  embedUrl?: string | null,
  provider?: string | null,
): PlaybackSource {
  if (provider === "streamtape") return { kind: "unsupported" };
  if (provider === "filekosh") {
    try {
      const url = new URL(embedUrl || "");
      if (
        url.origin === "https://filekosh.com" &&
        !url.username &&
        !url.password
      )
        return { kind: "embed", url: url.toString() };
    } catch {
      /* Missing or invalid returned embed. */
    }
    return { kind: "missing" };
  }
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
      return { kind, url: url.toString() };
    } catch {
      /* Invalid stored data must not become an executable iframe. */
    }
  }
  return { kind: "missing" };
}
