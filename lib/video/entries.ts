/**
 * Pure helpers for turning what an admin pastes into a list of publishable
 * entries, and for normalising the publish requests the admin UI sends.
 *
 * Kept free of Node-only imports so the same module is usable from the client
 * upload page, the API routes, and the unit tests.
 */

import { iframeSourceFrom, looksLikeIframeMarkup, normalizePastedLink } from "./links";

export const MAX_ENTRIES_PER_REQUEST = 20;

export type PublishEntry = { source: string; thumbnailPath: string | null };
export type RemoteEntry = { url: string; thumbnailPath: string | null };

/** Turns one pasted blob into a single normalised source string. */
function normalizeEntry(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const fromIframe = iframeSourceFrom(text);
  if (fromIframe) return fromIframe;
  return normalizePastedLink(text);
}

/** Splits pasted iframe markup into one entry per `<iframe>` tag (or per line). */
export function splitEmbedEntries(raw: string): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];

  if (looksLikeIframeMarkup(text)) {
    return text
      .split(/<\/iframe\s*>/i)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => iframeSourceFrom(chunk) || normalizePastedLink(chunk))
      .filter(Boolean);
  }
  return splitUrlEntries(text);
}

/**
 * Splits pasted links into one entry per line (or comma) and normalises each
 * one, so Markdown links (`[label](https://…)`), angle-bracket links, and URLs
 * carrying a trailing bracket or comma all collapse to the underlying URL.
 */
export function splitUrlEntries(raw: string): string[] {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/\r?\n|,/)
        .map((line) => normalizeEntry(line))
        .filter(Boolean)
    )
  );
}

function toThumbnailPath(value: unknown): string | null {
  const path = value === null || value === undefined ? "" : String(value).trim();
  return path || null;
}

/**
 * Normalises an embed request body into `{ source, thumbnailPath }` entries so
 * every iframe can carry its own thumbnail. The legacy single `embed` field is
 * still accepted, and pasted Markdown/iframe wrappers are unwrapped first.
 */
export function normalizeEmbedEntries(body: any): PublishEntry[] {
  const raw: any[] = Array.isArray(body?.entries)
    ? body.entries
    : [{ source: body?.embed ?? body?.source, thumbnailPath: body?.thumbnailPath }];

  return raw
    .map((entry) => ({
      source: normalizeEntry(entry?.source ?? entry?.url ?? entry?.embed),
      thumbnailPath: toThumbnailPath(entry?.thumbnailPath),
    }))
    .filter((entry) => entry.source)
    .slice(0, MAX_ENTRIES_PER_REQUEST);
}

/**
 * Normalises a remote-upload request body. Accepts
 * `entries: [{ url, thumbnailPath }]` — one thumbnail per link — or the legacy
 * newline-separated `urls` string with a single shared thumbnail.
 */
export function normalizeRemoteEntries(body: any): RemoteEntry[] {
  if (Array.isArray(body?.entries)) {
    return body.entries
      .map((entry: any) => ({
        url: normalizeEntry(entry?.url ?? entry?.source),
        thumbnailPath: toThumbnailPath(entry?.thumbnailPath),
      }))
      .filter((entry: RemoteEntry) => entry.url)
      .slice(0, MAX_ENTRIES_PER_REQUEST);
  }

  const sharedThumbnail = toThumbnailPath(body?.thumbnailPath);
  return splitUrlEntries(body?.urls || "")
    .slice(0, MAX_ENTRIES_PER_REQUEST)
    .map((url) => ({ url, thumbnailPath: sharedThumbnail }));
}
