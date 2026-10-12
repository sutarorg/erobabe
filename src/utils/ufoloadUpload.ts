/**
 * Browser → UFOLOAD direct, chunked, resumable upload.
 *
 * The server (`POST /api/videos/ufoload-session`) initialises the upload with
 * UFOLOAD using the server-only API key and hands the browser a *session*: the
 * node URL UFOLOAD returned, a grant for that one upload, the chunk size and the
 * byte ceiling. This module is the browser half of UFOLOAD's documented direct
 * upload protocol (OpenAPI `POST /api/v1/files/uploads`):
 *
 *   PUT {url}?offset=N    one chunk, `Authorization: <grant>`, a Content-Length
 *                         the BROWSER sets (it is a forbidden header — never set
 *                         here) and a body of at most `chunk_size` bytes
 *   GET {url}             → {"offset": N}: where the node really is, used to
 *                         resume after any failure
 *
 * Rules this file keeps, each covered by tests:
 *  - the URL is exactly the one UFOLOAD returned (only the documented `offset`
 *    query parameter is added) — it is never built or guessed;
 *  - the UFOLOAD API key is never involved: the grant is the only credential;
 *  - bodies are `Blob` slices of the file, so no byte is read into memory and
 *    the browser computes `Content-Length`;
 *  - chunk size and `max_bytes` come from the session, never from constants;
 *  - progress is real bytes: in-flight bytes come from `xhr.upload.onprogress`
 *    and are never reported as 100% until the node has accepted the last chunk;
 *  - after a network error, a 409 or any ambiguity the node is asked where it
 *    stands (`GET`) and the upload continues from THAT offset, never a guess;
 *  - a grant refused (401/403) or a session the node forgot (404/410) is a
 *    different error from a dropped connection: the first two need a new
 *    session, the last just needs a retry (`resumable`).
 */

import { UFOLOAD_KEEPALIVE_INTERVAL_MS, UFOLOAD_MAX_CHUNK_BYTES, formatBytes } from "@/lib/video/limits";
import { UploadAbortedError } from "@/src/utils/uploadFile";
import { uploadTiming } from "@/src/utils/uploadTiming";
import { windowedBytesPerSecond, type ByteSample } from "@/src/utils/uploadProgress";

export interface UfoloadUploadSession {
  /** Our own upload-job id (not sent to UFOLOAD). */
  jobId?: string;
  uploadId: string;
  /** The complete node URL UFOLOAD returned. */
  uploadUrl: string;
  /** Ready-made `Authorization` header value (`UfoGrant …`). */
  authorization: string;
  chunkSize: number;
  maxBytes: number;
  expiresAt: string | null;
}

export type UfoloadUploadErrorCode =
  | "invalid_session"
  | "file_too_large"
  | "grant_expired"
  | "session_lost"
  | "chunk_rejected"
  | "node_unavailable"
  | "network"
  | "stalled"
  | "offset_mismatch";

export class UfoloadUploadError extends Error {
  readonly code: UfoloadUploadErrorCode;
  readonly status: number | null;
  /** Bytes the node is known to have accepted when this happened. */
  readonly offset: number;
  /** True when calling `uploadFileInChunks` again with the SAME session can continue the upload. */
  readonly resumable: boolean;

  constructor(code: UfoloadUploadErrorCode, message: string, init: { status?: number | null; offset?: number; resumable?: boolean } = {}) {
    super(message);
    this.name = "UfoloadUploadError";
    this.code = code;
    this.status = init.status ?? null;
    this.offset = init.offset ?? 0;
    this.resumable = init.resumable ?? (code === "network" || code === "node_unavailable" || code === "stalled" || code === "offset_mismatch");
  }
}

export interface ChunkProgress {
  /** Bytes the node has accepted plus bytes of the current chunk the browser has sent. */
  loaded: number;
  total: number;
  /** 0–100. Reaches 100 only after the node has accepted the final byte. */
  percent: number;
  /** Over the last few seconds of observed bytes; `null` until a window is covered. */
  bytesPerSecond: number | null;
}

export interface UploadInChunksOptions {
  /** A `File` (or anything with a size and `slice`). */
  file: { size: number; slice(start: number, end: number): Blob };
  session: UfoloadUploadSession;
  signal?: AbortSignal;
  /** Ask the node where it stands and continue from there (retrying a half-sent upload). */
  resume?: boolean;
  onProgress?: (progress: ChunkProgress) => void;
  /**
   * Called about every `keepAliveIntervalMs` while bytes are moving. Must refresh
   * the upload slot through OUR server (the API key is server-side). Return `"gone"`
   * to stop the upload because UFOLOAD closed the session.
   */
  keepAlive?: () => Promise<"ok" | "gone" | void>;
  keepAliveIntervalMs?: number;
  /** Consecutive failures tolerated before giving up (resets whenever a chunk is accepted). */
  maxAttempts?: number;
  retryDelaysMs?: number[];
  /** Abort a chunk that moves no bytes for this long. */
  stallTimeoutMs?: number;
  // Test seams — production code passes none of these.
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  createXhr?: () => XMLHttpRequest;
  fetchImpl?: typeof fetch;
}

export interface UploadInChunksResult {
  bytes: number;
  chunks: number;
}

const SPEED_WINDOW_MS = 3000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadAbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The node URL with the documented `offset` parameter — nothing else is added or changed. */
export function chunkUrl(uploadUrl: string, offset: number): string {
  const url = new URL(uploadUrl);
  url.searchParams.set("offset", String(offset));
  return url.toString();
}

function percentOf(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (loaded / total) * 100));
}

function describeLocation(offset: number, total: number): string {
  return total > 0 ? ` at ${Math.floor(percentOf(offset, total))}%` : "";
}

export async function uploadFileInChunks(options: UploadInChunksOptions): Promise<UploadInChunksResult> {
  const { file, session, signal } = options;
  const total = file.size;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? uploadTiming.chunkMaxAttempts);
  const retryDelays = options.retryDelaysMs?.length ? options.retryDelaysMs : uploadTiming.chunkRetryDelaysMs;
  const stallTimeoutMs = options.stallTimeoutMs ?? uploadTiming.stallTimeoutMs;
  const keepAliveIntervalMs = options.keepAliveIntervalMs ?? UFOLOAD_KEEPALIVE_INTERVAL_MS;
  const createXhr = options.createXhr ?? (() => new XMLHttpRequest());
  const doFetch: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

  // ---- the session must be something the node will accept ------------------
  if (!Number.isFinite(total) || total <= 0) {
    throw new UfoloadUploadError("invalid_session", "The selected file is empty.", { resumable: false });
  }
  if (!Number.isFinite(session.maxBytes) || session.maxBytes <= 0 || !Number.isFinite(session.chunkSize) || session.chunkSize <= 0) {
    throw new UfoloadUploadError("invalid_session", "UFOLOAD returned unusable upload limits. Start the upload again.", { resumable: false });
  }
  if (total > session.maxBytes) {
    throw new UfoloadUploadError("file_too_large", `This file (${formatBytes(total)}) is larger than the ${formatBytes(session.maxBytes)} UFOLOAD allows for this upload.`, {
      resumable: false,
    });
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(session.uploadUrl);
  } catch {
    throw new UfoloadUploadError("invalid_session", "UFOLOAD returned an upload address that is not a valid URL.", { resumable: false });
  }
  const localDev = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
  if (parsedUrl.protocol !== "https:" && !(localDev && parsedUrl.protocol === "http:")) {
    throw new UfoloadUploadError("invalid_session", "The upload address is not https, so the browser would refuse to send the upload.", { resumable: false });
  }
  if (!session.authorization || /[\r\n]/.test(session.authorization)) {
    throw new UfoloadUploadError("invalid_session", "UFOLOAD returned no usable upload grant. Start the upload again.", { resumable: false });
  }
  const chunkSize = Math.min(Math.floor(session.chunkSize), UFOLOAD_MAX_CHUNK_BYTES);

  // ---- progress -----------------------------------------------------------
  const samples: ByteSample[] = [];
  let acceptedOffset = 0;
  const report = (loaded: number) => {
    // 100% only after the node has accepted the last byte.
    const capped = acceptedOffset >= total ? total : Math.min(loaded, total - 1);
    const at = now();
    samples.push({ at, bytes: capped });
    while (samples.length > 2 && at - samples[1].at > SPEED_WINDOW_MS * 2) samples.shift();
    options.onProgress?.({
      loaded: capped,
      total,
      percent: percentOf(capped, total),
      bytesPerSecond: windowedBytesPerSecond(samples, at, SPEED_WINDOW_MS),
    });
  };

  // ---- keep-alive (through our server; the API key never reaches the browser) ----
  let lastKeepAlive = now();
  let keepAliveInFlight = false;
  let sessionGone = false;
  let abortCurrent: (() => void) | null = null;
  const maybeKeepAlive = () => {
    if (!options.keepAlive || keepAliveInFlight || now() - lastKeepAlive < keepAliveIntervalMs) return;
    keepAliveInFlight = true;
    lastKeepAlive = now();
    Promise.resolve()
      .then(() => options.keepAlive!())
      .then((result) => {
        if (result === "gone") {
          sessionGone = true;
          abortCurrent?.();
        }
      })
      .catch(() => {
        // A failed keep-alive is not fatal: the next one (or the node) will tell us.
      })
      .finally(() => {
        keepAliveInFlight = false;
      });
  };

  const throwIfStopped = () => {
    if (signal?.aborted) throw new UploadAbortedError();
    if (sessionGone) throw sessionLostError();
  };
  const sessionLostError = () =>
    new UfoloadUploadError("session_lost", "UFOLOAD no longer has this upload session (it expired or was cancelled). Start the upload again.", {
      resumable: false,
      offset: acceptedOffset,
    });

  // ---- GET {url} → {"offset": N} ------------------------------------------
  const queryOffset = async (): Promise<number> => {
    throwIfStopped();
    let response: Response;
    try {
      response = await doFetch(session.uploadUrl, {
        method: "GET",
        headers: { Authorization: session.authorization },
        cache: "no-store",
        signal,
      });
    } catch {
      if (signal?.aborted) throw new UploadAbortedError();
      throw new UfoloadUploadError("network", networkMessage(acceptedOffset, total), { offset: acceptedOffset });
    }
    if (response.status === 401 || response.status === 403) {
      throw new UfoloadUploadError("grant_expired", "The upload permission from UFOLOAD expired. Start the upload again.", {
        status: response.status,
        resumable: false,
        offset: acceptedOffset,
      });
    }
    if (response.status === 404 || response.status === 410) throw sessionLostError();
    if (!response.ok) {
      throw new UfoloadUploadError("node_unavailable", `UFOLOAD's upload node answered ${response.status} when asked where to resume.`, {
        status: response.status,
        offset: acceptedOffset,
      });
    }
    const json = await response.json().catch(() => null);
    const offset = Number((json as { offset?: unknown } | null)?.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > total) {
      throw new UfoloadUploadError("invalid_session", "UFOLOAD's upload node returned an unusable resume position. Start the upload again.", {
        resumable: false,
        offset: acceptedOffset,
      });
    }
    return offset;
  };

  // ---- PUT {url}?offset=N --------------------------------------------------
  /** Resolves with the node's own statement of the accepted offset, or `null` if it made none. */
  const putChunk = (offset: number, blob: Blob): Promise<number | null> =>
    new Promise<number | null>((resolve, reject) => {
      throwIfStopped();
      const xhr = createXhr();
      let settled = false;
      let stalled = false;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;

      const onAbortSignal = () => xhr.abort();
      const cleanup = () => {
        clearTimeout(stallTimer);
        signal?.removeEventListener("abort", onAbortSignal);
        abortCurrent = null;
      };
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        action();
      };
      const armStallTimer = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          stalled = true;
          xhr.abort();
        }, stallTimeoutMs);
      };

      xhr.open("PUT", chunkUrl(session.uploadUrl, offset), true);
      // Only these two headers. `Content-Length` is a forbidden header name: the
      // browser derives it from the Blob, and setting it would be silently ignored.
      xhr.setRequestHeader("Authorization", session.authorization);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.withCredentials = false;

      xhr.upload.onprogress = (event: ProgressEvent) => {
        armStallTimer();
        report(offset + Math.min(event.loaded, blob.size));
        maybeKeepAlive();
      };
      xhr.onload = () =>
        settle(() => {
          const status = xhr.status;
          if (status >= 200 && status < 300) {
            let accepted: number | null = null;
            try {
              const body = JSON.parse(xhr.responseText || "null");
              const value = Number(body?.offset);
              if (body && body.offset !== undefined && Number.isInteger(value)) accepted = value;
            } catch {
              accepted = null;
            }
            resolve(accepted);
            return;
          }
          if (status === 401 || status === 403) {
            reject(new UfoloadUploadError("grant_expired", "The upload permission from UFOLOAD expired. Start the upload again.", { status, resumable: false, offset }));
          } else if (status === 404 || status === 410) {
            reject(sessionLostError());
          } else if (status === 409 || status === 416) {
            reject(new UfoloadUploadError("offset_mismatch", "UFOLOAD's upload node is at a different position than the browser expected; resyncing.", { status, offset }));
          } else if (status === 413) {
            reject(new UfoloadUploadError("file_too_large", "UFOLOAD's upload node refused the data as too large.", { status, resumable: false, offset }));
          } else if (status === 408 || status === 425 || status === 429 || status >= 500) {
            reject(new UfoloadUploadError("node_unavailable", `UFOLOAD's upload node is busy or unavailable (HTTP ${status}).`, { status, offset }));
          } else {
            reject(new UfoloadUploadError("chunk_rejected", `UFOLOAD's upload node rejected the data (HTTP ${status || "no response"}).`, { status, resumable: false, offset }));
          }
        });
      xhr.onerror = () => settle(() => reject(new UfoloadUploadError("network", networkMessage(offset, total), { offset })));
      xhr.ontimeout = () => settle(() => reject(new UfoloadUploadError("stalled", stallMessage(), { offset })));
      xhr.onabort = () =>
        settle(() => {
          if (stalled) reject(new UfoloadUploadError("stalled", stallMessage(), { offset }));
          else if (sessionGone) reject(sessionLostError());
          else reject(new UploadAbortedError());
        });

      abortCurrent = () => xhr.abort();
      signal?.addEventListener("abort", onAbortSignal, { once: true });
      armStallTimer();
      xhr.send(blob);
    });

  // ---- the loop ------------------------------------------------------------
  let chunks = 0;
  let failures = 0;
  let offset = 0;

  const recover = async (error: unknown): Promise<void> => {
    if (error instanceof UploadAbortedError) throw error;
    if (!(error instanceof UfoloadUploadError) || !error.resumable) throw error;

    failures += 1;
    if (failures >= maxAttempts) {
      throw new UfoloadUploadError(error.code === "offset_mismatch" ? "node_unavailable" : error.code, error.message, {
        status: error.status,
        offset: acceptedOffset,
        resumable: true,
      });
    }
    if (error.code !== "offset_mismatch") await sleep(retryDelays[Math.min(failures - 1, retryDelays.length - 1)], signal);

    // Ask the node where it really is and continue from THAT offset.
    try {
      offset = await queryOffset();
      acceptedOffset = offset;
      report(offset);
    } catch (queryError) {
      if (queryError instanceof UploadAbortedError) throw queryError;
      if (queryError instanceof UfoloadUploadError && !queryError.resumable) throw queryError;
      // The node could not be reached for the question either — the next PUT will fail the same way and count again.
    }
  };

  if (options.resume) {
    // Retrying a half-sent upload: ask the node where it stands (with the same backoff as any other failure).
    for (;;) {
      try {
        offset = await queryOffset();
        break;
      } catch (error) {
        if (error instanceof UploadAbortedError || !(error instanceof UfoloadUploadError) || !error.resumable) throw error;
        failures += 1;
        if (failures >= maxAttempts) throw error;
        await sleep(retryDelays[Math.min(failures - 1, retryDelays.length - 1)], signal);
      }
    }
    acceptedOffset = offset;
    failures = 0;
    report(offset);
  } else {
    report(0);
  }

  while (offset < total) {
    throwIfStopped();
    maybeKeepAlive();
    const end = Math.min(offset + chunkSize, total);
    try {
      const reported = await putChunk(offset, file.slice(offset, end));
      // A 2xx with no statement means the whole chunk. If the node said anything else — the docs do not
      // define the PUT response body — it is not trusted or guessed at: the node's own answer to
      // `GET {url}` (documented: {"offset": N}) decides where the upload continues.
      let next = reported ?? end;
      if (next !== end) next = await queryOffset();
      if (next > total) {
        throw new UfoloadUploadError("offset_mismatch", "UFOLOAD's upload node reported a position beyond the end of the file; resyncing.", { offset });
      }
      if (next <= offset) {
        throw new UfoloadUploadError("node_unavailable", "UFOLOAD's upload node accepted no data from this chunk.", { offset });
      }
      offset = next;
      acceptedOffset = offset;
      chunks += 1;
      failures = 0;
      report(offset);
    } catch (error) {
      await recover(error);
    }
  }

  return { bytes: total, chunks };
}

function networkMessage(offset: number, total: number): string {
  return `The connection to UFOLOAD's upload node dropped${describeLocation(offset, total)}. Retry to resume from where it stopped. If this keeps happening, check your connection, VPN or ad blocker — the browser must be able to reach UFOLOAD's upload servers (see DEPLOYMENT.md, “CORS and network check”).`;
}

function stallMessage(): string {
  return "The upload stalled — UFOLOAD's upload node accepted no data for two minutes. Retry to resume from where it stopped.";
}
