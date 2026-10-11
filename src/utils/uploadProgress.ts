/**
 * Progress and throughput estimation for uploads whose bytes the browser
 * cannot observe.
 *
 * A direct POST to Uqload must stay a CORS "simple request" (see
 * `uploadFile.uploadFormDirect`), so no `xhr.upload` progress events may be
 * registered — and a `fetch()` streaming body is not an option either, because
 * Uqload's upload servers speak HTTP/1.1 (Chrome refuses streamed request
 * bodies there). The admin UI therefore advances the bar from the file size
 * and the throughput this browser actually measured on previous uploads, labels
 * it as an estimate, and snaps to 100% only when the request really completes.
 *
 * Everything here is pure except for the two `localStorage` helpers, so the
 * maths is unit-testable.
 */

const STORAGE_KEY = "erobabe:upload-link-bytes-per-second";

/** Seed used until this browser has measured a real upload: ~16 Mbit/s up. */
export const DEFAULT_LINK_BYTES_PER_SECOND = 2 * 1024 * 1024;

const MIN_LINK_BYTES_PER_SECOND = 128 * 1024;
const MAX_LINK_BYTES_PER_SECOND = 250 * 1024 * 1024;

/**
 * Shape of the progress curve: the estimate reaches 85% at the expected
 * duration (fraction = t / (t + k) = 0.85 → k = (1 - 0.85) / 0.85) and only
 * approaches 100% well past it, so the bar can never claim a transfer finished
 * while the request is still open.
 */
const TRANSFER_CURVE_K = (1 - 0.85) / 0.85;
const TRANSFER_CURVE_MAX = 0.985;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Blocked by privacy settings (Safari private mode, enterprise policy).
    return null;
  }
}

/** Keeps a rate inside the range a real uplink can plausibly be. */
export function clampLinkRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_LINK_BYTES_PER_SECOND;
  return Math.min(MAX_LINK_BYTES_PER_SECOND, Math.max(MIN_LINK_BYTES_PER_SECOND, rate));
}

/** The uplink throughput this browser measured last, or `null` when unknown. */
export function readRememberedLinkRate(storage: Storage | null = safeStorage()): number | null {
  if (!storage) return null;
  try {
    const value = Number(storage.getItem(STORAGE_KEY));
    if (!Number.isFinite(value) || value <= 0) return null;
    return clampLinkRate(value);
  } catch {
    return null;
  }
}

/**
 * Folds a freshly measured throughput into the remembered rate (a 50/50
 * exponential average, so one flaky measurement cannot wreck the estimate).
 * Returns the rate that will be used for the next estimate.
 */
export function rememberLinkRate(
  observedBytesPerSecond: number,
  storage: Storage | null = safeStorage()
): number | null {
  if (!Number.isFinite(observedBytesPerSecond) || observedBytesPerSecond <= 0) return null;
  const observed = clampLinkRate(observedBytesPerSecond);
  const previous = readRememberedLinkRate(storage);
  const next = previous === null ? observed : previous * 0.5 + observed * 0.5;
  try {
    storage?.setItem(STORAGE_KEY, String(Math.round(next)));
  } catch {
    // Storage full or unavailable — the estimate simply stays un-remembered.
  }
  return next;
}

/**
 * How much of an upload has plausibly been sent after `elapsedMs`, given an
 * `expectedMs` duration. Monotonic in time and asymptotic in 1, so a stalled
 * upload keeps the bar short of the end instead of lying about finishing.
 */
export function estimateTransferFraction(elapsedMs: number, expectedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(expectedMs) || expectedMs <= 0) return 0;
  const fraction = elapsedMs / (elapsedMs + expectedMs * TRANSFER_CURVE_K);
  return Math.min(TRANSFER_CURVE_MAX, fraction);
}

/**
 * The share of the link one transfer can expect while `activeUploads` files
 * upload at the same time (parallel uploads split the same uplink).
 */
export function ratePerActiveUpload(linkBytesPerSecond: number, activeUploads: number): number {
  const sharing = Math.max(1, Math.floor(Number.isFinite(activeUploads) ? activeUploads : 1));
  return clampLinkRate(linkBytesPerSecond) / sharing;
}

/** `2.4 MB/s`, `870 KB/s` — coarse on purpose, it is an estimate. */
export function formatBytesPerSecond(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "—";
  if (rate >= 1024 * 1024) return `${(rate / (1024 * 1024)).toFixed(rate >= 10 * 1024 * 1024 ? 0 : 1)} MB/s`;
  if (rate >= 1024) return `${Math.round(rate / 1024)} KB/s`;
  return `${Math.round(rate)} B/s`;
}

/** `45s`, `3m 20s`, `1h 05m` — a rounded "about this long" for ETAs. */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
