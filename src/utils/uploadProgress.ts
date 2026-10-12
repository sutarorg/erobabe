/**
 * Progress helpers for admin uploads.
 *
 * Video uploads to UFOLOAD are chunked XHR requests, so the browser observes
 * real bytes (`src/utils/ufoloadUpload.ts`). The admin page still must not
 * invent a percentage, a speed, or a remaining time from
 * `estimateTransferFraction` or a remembered link rate — that curve races to
 * ~85% and then crawls, which is not a measurement.
 *
 * `windowedBytesPerSecond` is the only speed the UI may show, and only from
 * samples of bytes that were actually sent. With no samples it returns null
 * and the speed is omitted.
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

export type ByteSample = { at: number; bytes: number };

/**
 * Throughput over the last `windowMs` of *observed* bytes.
 *
 * Returns `null` until the samples actually cover a full window, so the UI
 * never prints a guessed rate for the first second. A stall (no new bytes)
 * pulls the rate down, because the window is measured against `now`, not
 * against the last sample.
 */
export function windowedBytesPerSecond(
  samples: ReadonlyArray<ByteSample>,
  now: number,
  windowMs = 1000
): number | null {
  if (!samples.length || !Number.isFinite(now) || !Number.isFinite(windowMs) || windowMs <= 0) return null;
  const first = samples[0];
  if (!first || now - first.at < windowMs) return null;

  const windowStart = now - windowMs;
  let baseline: ByteSample | null = null;
  let latest: ByteSample | null = null;
  for (const sample of samples) {
    if (sample.at > now) break;
    if (sample.at <= windowStart) baseline = sample;
    latest = sample;
  }
  if (!latest) return null;
  const start = baseline ?? first;
  const spanSeconds = (now - start.at) / 1000;
  if (spanSeconds <= 0) return null;
  const delta = latest.bytes - start.bytes;
  if (!Number.isFinite(delta) || delta < 0) return null;
  return delta / spanSeconds;
}

/** 0–100 from bytes actually sent. Linear — never eases off near the end. */
export function transferPercent(loaded: number, total: number): number {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0 || loaded <= 0) return 0;
  return Math.max(0, Math.min(100, (loaded / total) * 100));
}

/**
 * Live speed label. One decimal on MB/s so a one-second update is visible,
 * unlike the coarser estimate formatter.
 */
export function formatLiveBytesPerSecond(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) return "—";
  if (rate >= 1024 * 1024) return `${(rate / (1024 * 1024)).toFixed(1)} MB/s`;
  if (rate >= 1024) return `${Math.round(rate / 1024)} KB/s`;
  if (rate > 0) return `${Math.max(1, Math.round(rate))} B/s`;
  return "0 KB/s";
}

/** Row copy while bytes are moving. No countdown. Speed is omitted when it was not measured. */
export function formatUploadStatus(percent: number, bytesPerSecond: number | null): string {
  const pct = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) return `Uploading to UFOLOAD — ${pct}%`;
  return `Uploading to UFOLOAD — ${pct}% · ${formatLiveBytesPerSecond(bytesPerSecond)}`;
}
