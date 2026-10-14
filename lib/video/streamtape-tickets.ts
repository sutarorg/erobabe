/**
 * Short-lived, in-memory cache for Streamtape media links — server-only.
 *
 * Resolving a Streamtape download link costs two sequential API round trips
 * (`/file/dlticket` then `/file/dl`) plus the `wait_time` the API may ask for.
 * Doing that *inside* the click-to-first-frame path is why playback used to sit
 * on "Preparing video…" for seconds. The browser asks for a media element as
 * soon as the watch page loads, so the first request pays the ticket cost and
 * every following request — the actual play click, a seek, the next byte range
 * — is answered from this cache.
 *
 * Guarantees:
 *
 * - Entries are **memory only**. A ticket URL is never written to the database,
 *   a log line, or a browser: `/api/videos/{id}/playback` keeps consuming the
 *   link server-side and only ever streams bytes.
 * - Entries expire after a few minutes; the media host may reuse a download
 *   link for a limited time and no longer. An expired link is replaced lazily,
 *   and a link that upstream rejects is dropped so the next attempt resolves a
 *   fresh one ({@link forgetStreamtapeTicket}).
 * - Concurrent requests for the same file share one resolution (single flight),
 *   which also keeps the provider's rate limits happy.
 * - Every URL is validated against the media allowlist before it is cached, so
 *   a bad API answer can never be replayed later.
 */

import { safeStreamtapeMediaUrl } from "./playback";
import { createDownloadUrl } from "./streamtape";

/**
 * How long a resolved link stays usable. Streamtape does not document the
 * lifetime of a `/file/dl` link; keep the window short so a stale link is
 * replaced long before the media host would reject it.
 */
export const STREAMTAPE_TICKET_TTL_MS = 4 * 60 * 1000;

/** Hard cap on cached links, so a busy catalog cannot grow memory without end. */
export const STREAMTAPE_TICKET_MAX_ENTRIES = 100;

type CacheEntry = { url: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

/** File ids come from a validated embed/watch URL; keep the surface tiny anyway. */
function validFileId(fileId: unknown): fileId is string {
  return typeof fileId === "string" && /^[A-Za-z0-9]{4,64}$/.test(fileId);
}

function evict(): void {
  const now = Date.now();
  for (const [fileId, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(fileId);
  }
  // `Map` iterates in insertion order, so the first key is the oldest.
  while (cache.size > STREAMTAPE_TICKET_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** The cached link for a file, or `null` when there is none (or it expired). */
export function cachedStreamtapeTicket(fileId: string): string | null {
  if (!validFileId(fileId)) return null;
  const entry = cache.get(fileId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(fileId);
    return null;
  }
  // Refresh recency so eviction drops genuinely cold entries first.
  cache.delete(fileId);
  cache.set(fileId, entry);
  return entry.url;
}

/** Stores a link that upstream just accepted. Invalid answers are rejected. */
export function rememberStreamtapeTicket(
  fileId: string,
  url: string,
  ttlMs: number = STREAMTAPE_TICKET_TTL_MS
): void {
  if (!validFileId(fileId)) return;
  // Throws for anything that is not an allowlisted media host — a later request
  // must never replay an unvalidated URL.
  const safe = safeStreamtapeMediaUrl(url);
  cache.set(fileId, { url: safe, expiresAt: Date.now() + Math.max(ttlMs, 0) });
  evict();
}

/** Drops a link upstream rejected or that expired mid-playback. */
export function forgetStreamtapeTicket(fileId: string): void {
  cache.delete(fileId);
}

export type StreamtapeTicket = {
  /** Validated media URL — server-side only, never sent to a browser. */
  url: string;
  /** `true` when the link came from the cache, i.e. playback can start now. */
  fromCache: boolean;
};

/**
 * Returns a usable media link, resolving (and caching) one only when needed.
 * Throws whatever `createDownloadUrl` throws — messages are credential-free.
 */
export async function resolveStreamtapeTicket(fileId: string): Promise<StreamtapeTicket> {
  if (!validFileId(fileId)) throw new Error("Invalid Streamtape file id");

  const cached = cachedStreamtapeTicket(fileId);
  if (cached) return { url: cached, fromCache: true };

  const pending = inflight.get(fileId);
  if (pending) return { url: await pending, fromCache: true };

  const resolution = createDownloadUrl(fileId).then((url) => {
    rememberStreamtapeTicket(fileId, url);
    return safeStreamtapeMediaUrl(url);
  });
  inflight.set(fileId, resolution);
  try {
    return { url: await resolution, fromCache: false };
  } finally {
    if (inflight.get(fileId) === resolution) inflight.delete(fileId);
  }
}

/**
 * Resolves a link ahead of the play click. Never throws: a failure just means
 * the click will do the work itself, exactly as it did before.
 */
export async function warmStreamtapeTicket(fileId: string): Promise<boolean> {
  try {
    await resolveStreamtapeTicket(fileId);
    return true;
  } catch {
    return false;
  }
}

/** Test/ops helper: forget every cached link. */
export function clearStreamtapeTicketCache(): void {
  cache.clear();
  inflight.clear();
}

export function streamtapeTicketCacheSize(): number {
  return cache.size;
}
