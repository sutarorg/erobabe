/**
 * Server-only caches that let Streamtape-backed videos start playing at once.
 *
 * Why this exists
 * ---------------
 * Streamtape issues a media link in two steps: `/file/dlticket`, then — only
 * after the ticket's `wait_time`, documented as 10 seconds — `/file/dl`. The
 * playback route used to run that handshake for *every* byte-range request.
 * A browser needs several ranges to start an MP4 (probe, `moov` atom, first
 * frames), so visitors watched "Preparing video…" for 10–30 seconds, and every
 * seek waited roughly another 10 seconds.
 *
 * What it does
 * ------------
 * - A resolved link is reused by every request for that file until it ages
 *   out or the media host rejects it. Concurrent requests share a single
 *   in-flight handshake instead of each starting their own.
 * - A link older than {@link LINK_REFRESH_AFTER_MS} keeps serving while a new
 *   one is resolved in the background, so active viewers never see the wait.
 * - The watch page asks the playback route to prepare the link as soon as it
 *   opens (see `POST /api/videos/[id]/playback`), so pressing Play normally
 *   finds the handshake already done.
 * - A positive catalogue access decision is remembered for
 *   {@link ACCESS_TTL_MS}, so range and seek requests skip a database round
 *   trip without letting an unpublished video stay playable for long.
 *
 * Security
 * --------
 * Links can be bound to the IP address that requested them, so they live only
 * in this process's memory — on the instance that consumes them — and are
 * never written to the database, a shared cache, a log line, or a response.
 * Only links that pass {@link safeStreamtapeMediaUrl} are cached.
 *
 * Logs
 * ----
 * Every handshake and every refused link writes one `[playback]` line (file
 * ID, duration or age, HTTP status, error code), so the hosting logs show
 * whether links are really reused and how long Streamtape takes. Links,
 * tickets, credentials and provider messages are never logged.
 */

import { safeStreamtapeMediaUrl } from "@/lib/video/playback";
import { createDownloadUrl } from "@/lib/video/streamtape";

/** After this age a link still serves, but a replacement is resolved in the background. */
export const LINK_REFRESH_AFTER_MS = 20 * 60_000;
/** A link older than this is never used; the next request waits for a new handshake. */
export const LINK_MAX_AGE_MS = 2 * 60 * 60_000;
/** How long a published-and-approved decision is trusted without asking the database again. */
export const ACCESS_TTL_MS = 60_000;
/** Bounds memory: the least recently used entries are dropped first. */
const MAX_ENTRIES = 1_000;

export type StreamtapeLink = { fileId: string; url: string; resolvedAt: number };

/** What started a handshake: the page preparing, a media request, or a background refresh. */
type HandshakeReason = "prepare" | "request" | "refresh";

type Store = {
  links: Map<string, StreamtapeLink>;
  inflight: Map<string, Promise<StreamtapeLink>>;
  access: Map<string, { fileId: string; expiresAt: number }>;
  generation: number;
};

/**
 * One store per process. Kept on `globalThis` so a module that is bundled or
 * hot-reloaded more than once still shares a single cache.
 */
const STORE_KEY = Symbol.for("erobabe.playback-cache");
function store(): Store {
  const holder = globalThis as typeof globalThis & { [STORE_KEY]?: Store };
  return (holder[STORE_KEY] ??= { links: new Map(), inflight: new Map(), access: new Map(), generation: 0 });
}

/** Insert as most-recently-used, evicting the oldest entries past the bound. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function ageOf(link: StreamtapeLink): number {
  return Date.now() - link.resolvedAt;
}

function duration(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}

/** A fixed error code only: provider messages can contain links or credentials. */
function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && error.name === "StreamtapeError" && typeof code === "string" ? code : "untrusted_link";
}

/** Runs (or joins) the ticket → wait → link handshake for one file. */
function handshake(fileId: string, reason: HandshakeReason): Promise<StreamtapeLink> {
  const cache = store();
  const running = cache.inflight.get(fileId);
  if (running) return running;

  const generation = cache.generation;
  const startedAt = Date.now();
  const task: Promise<StreamtapeLink> = Promise.resolve()
    .then(() => createDownloadUrl(fileId))
    .then((raw) => {
      // Never cache (or later fetch) something that is not a Streamtape media URL.
      const link = { fileId, url: safeStreamtapeMediaUrl(raw), resolvedAt: Date.now() };
      if (store().generation === generation) remember(store().links, fileId, link);
      console.info(`[playback] Streamtape link ready in ${duration(Date.now() - startedAt)} (file ${fileId}, ${reason})`);
      return link;
    })
    .catch((error: unknown) => {
      console.warn(
        `[playback] Streamtape link failed after ${duration(Date.now() - startedAt)} (file ${fileId}, ${reason}): ${failureCode(error)}`
      );
      throw error;
    })
    .finally(() => {
      if (store().inflight.get(fileId) === task) store().inflight.delete(fileId);
    });
  cache.inflight.set(fileId, task);
  return task;
}

/**
 * A usable media link for `fileId`.
 *
 * `cached` is true when the link was resolved before this call; only such a
 * link can have expired, so only then is a retry with a fresh one worthwhile.
 */
export async function getStreamtapeLink(fileId: string): Promise<{ link: StreamtapeLink; cached: boolean }> {
  const cache = store();
  const link = cache.links.get(fileId);
  if (link && ageOf(link) < LINK_MAX_AGE_MS) {
    remember(cache.links, fileId, link);
    if (ageOf(link) >= LINK_REFRESH_AFTER_MS) {
      // Serve the current link now; the replacement is picked up by later requests.
      handshake(fileId, "refresh").catch(() => undefined);
    }
    return { link, cached: true };
  }
  return { link: await handshake(fileId, "request"), cached: false };
}

/**
 * Makes sure a fresh link is ready (or being resolved) before playback starts.
 * Resolves when the link is ready; rejects if Streamtape cannot provide one.
 */
export async function prepareStreamtapeLink(fileId: string): Promise<void> {
  const link = store().links.get(fileId);
  if (link && ageOf(link) < LINK_REFRESH_AFTER_MS) return;
  await handshake(fileId, "prepare");
}

/**
 * Drops a link the media host rejected — unless a newer one already replaced
 * it — and logs it: the HTTP status and the link's age show how long Streamtape
 * links really last.
 */
export function invalidateStreamtapeLink(
  link: StreamtapeLink,
  { status = null, retrying = false }: { status?: number | null; retrying?: boolean } = {}
): void {
  const { links } = store();
  if (links.get(link.fileId) === link) links.delete(link.fileId);
  console.warn(
    `[playback] Media host did not serve video for a Streamtape link (file ${link.fileId}, ` +
    `${status === null ? "connection failed" : `HTTP ${status}`}, ${duration(ageOf(link))} old)` +
    (retrying ? "; retrying with a fresh link" : "")
  );
}

/** Records that `videoId` passed the published/public/cleared/approved checks. */
export function rememberPlaybackAccess(videoId: string, fileId: string): void {
  remember(store().access, videoId, { fileId, expiresAt: Date.now() + ACCESS_TTL_MS });
}

/** The Streamtape file of a recently verified video, or `null` if it must be checked again. */
export function recallPlaybackAccess(videoId: string): string | null {
  const { access } = store();
  const entry = access.get(videoId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    access.delete(videoId);
    return null;
  }
  return entry.fileId;
}

/** Test hook: forget every cached link and access decision. */
export function resetPlaybackCache(): void {
  const cache = store();
  cache.links.clear();
  cache.inflight.clear();
  cache.access.clear();
  cache.generation += 1;
}
