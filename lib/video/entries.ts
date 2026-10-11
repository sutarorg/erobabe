/**
 * Pure helpers for turning what an admin pastes into a list of publishable
 * entries, and for normalising the publish requests the admin UI sends.
 *
 * Kept free of Node-only imports so the same module is usable from the client
 * upload page, the API routes, and the unit tests.
 */

export const MAX_ENTRIES_PER_REQUEST = 20;

export type PublishEntry = { source: string; thumbnailPath: string | null };
export type RemoteEntry = { url: string; thumbnailPath: string | null };

/** Splits pasted iframe markup into one entry per `<iframe>` tag (or per line). */
export function splitEmbedEntries(raw: string): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];

  if (/<iframe/i.test(text)) {
    return text
      .split(/<\/iframe\s*>/i)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Splits pasted links into one entry per line (or comma), de-duplicated. */
export function splitUrlEntries(raw: string): string[] {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/\r?\n|,/)
        .map((line) => line.trim())
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
 * still accepted.
 */
export function normalizeEmbedEntries(body: any): PublishEntry[] {
  const raw: any[] = Array.isArray(body?.entries)
    ? body.entries
    : [{ source: body?.embed ?? body?.source, thumbnailPath: body?.thumbnailPath }];

  return raw
    .map((entry) => ({
      source: String(entry?.source ?? "").trim(),
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
        url: String(entry?.url ?? entry?.source ?? "").trim(),
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
