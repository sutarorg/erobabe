/**
 * Chunked, resumable transfer of one video file to a UFOLOAD upload node.
 *
 * The orchestration is pure: it talks to an injected transport, so the offset
 * arithmetic, retries, resume reconciliation and keep-alive schedule are unit
 * tested without a network or a browser.
 *
 * Documented constraints implemented here:
 *   - each chunk is at most `chunk_size` (and never more than 256 MiB);
 *   - the `?offset=` of a chunk must match what the node already accepted;
 *   - after an interruption `GET {url}` reports the accepted offset;
 *   - `GET /files/uploads/{upload_id}` must be called at least once every
 *     10 minutes during a long transfer (this transport pings every 5).
 */

import {
  planNextChunk,
  reconcileResumeOffset,
  uploadPercent,
  type ChunkPlan,
} from "@/lib/video/ufoload-protocol";

/** Raised when the admin cancels; the caller returns the row to the queue. */
function abortedError(): Error {
  const error = new Error("Upload cancelled");
  error.name = "UploadAbortedError";
  return error;
}

export const DEFAULT_KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_CHUNK_ATTEMPTS = 4;
export const DEFAULT_RETRY_DELAY_MS = 750;

export interface ChunkTransport {
  /** Sends one chunk at `offset`; must resolve only after the node accepted it. */
  putChunk(offset: number, chunk: Blob): Promise<void>;
  /** Reads the node's accepted offset (`null` when it cannot be read). */
  reconcileOffset(): Promise<number | null>;
  /** Keeps the upload's concurrency slot alive server-side. */
  keepAlive(): Promise<void>;
}

export interface UploadFileInChunksOptions {
  file: Blob & { size: number; name?: string };
  /** `chunk_size` from the upload grant. */
  chunkSize: number;
  /** `max_bytes` from the upload grant, when the provider sent one. */
  maxBytes?: number | null;
  transport: ChunkTransport;
  signal?: AbortSignal;
  /** Bytes transferred so far, across resumes. */
  onProgress?: (uploadedBytes: number, totalBytes: number, percent: number) => void;
  onResume?: (acceptedOffset: number, reason: string) => void;
  keepAliveIntervalMs?: number;
  attempts?: number;
  retryDelayMs?: number;
  now?: () => number;
}

export interface ChunkedUploadResult {
  uploadedBytes: number;
  totalBytes: number;
  resumedFrom: number | null;
}

/**
 * Uploads the whole blob, resuming from the provider's accepted offset whenever
 * something interrupts the transfer. Throws only when the file really could not
 * be handed over — never after a partial success that the caller cannot detect.
 */
export async function uploadFileInChunks(options: UploadFileInChunksOptions): Promise<ChunkedUploadResult> {
  const { file, chunkSize, maxBytes = null, transport, signal } = options;
  const total = Math.max(0, Math.floor(file.size));
  const attempts = Math.max(1, options.attempts ?? DEFAULT_CHUNK_ATTEMPTS);
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const keepAliveIntervalMs = options.keepAliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());

  let offset = 0;
  let resumedFrom: number | null = null;
  let lastKeepAliveAt = now();

  const aborted = () => {
    if (signal?.aborted) throw abortedError();
  };

  const ping = async () => {
    try {
      await transport.keepAlive();
    } catch {
      // A failed keep-alive is not fatal: the slot only frees after 15 minutes
      // without requests, and the next chunk is itself activity.
    } finally {
      lastKeepAliveAt = now();
    }
  };

  options.onProgress?.(0, total, uploadPercent(0, total));

  while (true) {
    aborted();

    const plan: ChunkPlan = planNextChunk({ size: total, offset, chunkSize, maxBytes });
    if (plan.done) break;

    if (now() - lastKeepAliveAt >= keepAliveIntervalMs) await ping();

    const chunk = file.slice(plan.offset, plan.offset + plan.length);
    let lastError: unknown = null;
    let advanced = false;

    for (let attempt = 0; attempt < attempts; attempt++) {
      aborted();
      try {
        await transport.putChunk(plan.offset, chunk);
        advanced = true;
        break;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw abortedError();

        // The node may have received part of the chunk (or none of it), and a
        // mismatched offset means our bookkeeping drifted. Ask it what it has
        // before sending anything else — this is what makes resume exact.
        const accepted = await transport.reconcileOffset().catch(() => null);
        const resumeAt = reconcileResumeOffset({ accepted, sent: plan.offset, total });
        if (resumeAt !== plan.offset) {
          offset = resumeAt;
          resumedFrom = resumeAt;
          options.onResume?.(resumeAt, error instanceof Error ? error.message : "transfer interrupted");
          options.onProgress?.(resumeAt, total, uploadPercent(resumeAt, total));
          break; // re-plan from the accepted offset
        }

        if (attempt < attempts - 1) await delay(retryDelayMs * (attempt + 1), signal);
      }
    }

    if (advanced) {
      offset = plan.offset + plan.length;
      options.onProgress?.(offset, total, uploadPercent(offset, total));
      continue;
    }

    if (offset !== plan.offset) continue; // reconciled above — replan
    throw lastError instanceof Error
      ? lastError
      : new Error("The transfer to UFOLOAD was interrupted and could not be resumed.");
  }

  if (offset < total) {
    throw new Error(
      `Only ${offset} of ${total} bytes reached UFOLOAD. The upload was not completed — retry to resume from the accepted offset.`
    );
  }

  options.onProgress?.(total, total, 100);
  return { uploadedBytes: offset, totalBytes: total, resumedFrom };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
