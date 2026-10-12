/**
 * Timing knobs for the admin upload page and the chunk uploader: how often
 * processing status is polled, how long a chunk is retried, how long a link
 * waits for one of UFOLOAD's import slots.
 *
 * A plain mutable object (not constants) only so tests can shorten the delays;
 * production code never writes to it.
 */
export const uploadTiming = {
  /** Status polling: first check, then every `intervalMs` while something changes, backing off 1.5× up to `maxIntervalMs` while nothing does. */
  initialDelayMs: 2_000,
  intervalMs: 4_000,
  maxIntervalMs: 15_000,

  /** Completing an upload is idempotent, so a transient failure is retried after these delays. */
  registerRetryDelaysMs: [1_500, 3_000, 6_000, 12_000] as number[],

  /** When UFOLOAD's 10 import slots are full: wait this long before asking again (`null` = use the server's Retry-After, clamped to 1–60 s). */
  importSlotRetryMs: null as number | null,

  /** Chunk uploader defaults. */
  chunkMaxAttempts: 5,
  chunkRetryDelaysMs: [1_000, 2_000, 4_000, 8_000, 15_000] as number[],
  stallTimeoutMs: 120_000,
};

/** The next polling delay: reset to the base interval after a change, otherwise back off. */
export function nextPollDelay(previousMs: number, changed: boolean): number {
  if (changed) return uploadTiming.intervalMs;
  return Math.min(uploadTiming.maxIntervalMs, Math.round(previousMs * 1.5));
}
