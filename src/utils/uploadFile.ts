/**
 * Browser → storage upload helpers with real progress events.
 *
 * Used for direct FileKosh video PUTs and Supabase thumbnail PUTs. Video bytes
 * never pass through Erobabe.
 */

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  bytesPerSecond: number | null;
}

export interface UploadOptions {
  contentType?: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

function attachProgress(xhr: XMLHttpRequest, totalHint: number, options: UploadOptions) {
  const startedAt = Date.now();
  xhr.upload.onprogress = (event) => {
    if (!options.onProgress || !event.lengthComputable) return;
    const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.001);
    options.onProgress({
      loaded: event.loaded,
      total: event.total || totalHint,
      percent: event.total ? Math.min(100, (event.loaded / event.total) * 100) : 0,
      bytesPerSecond: event.loaded / elapsed,
    });
  };
}

/** Small files (thumbnails) — PUT to a short-lived signed storage URL. */
export function uploadWithProgress(url: string, body: File | Blob, options: UploadOptions = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (options.contentType !== "") xhr.setRequestHeader("Content-Type", options.contentType || body.type || "application/octet-stream");
    for (const [name, value] of Object.entries(options.headers || {})) xhr.setRequestHeader(name, value);
    attachProgress(xhr, body.size, options);

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.({ loaded: body.size, total: body.size, percent: 100, bytesPerSecond: null });
        resolve();
        return;
      }
      reject(new Error(`Storage rejected the upload (${xhr.status || "no response"}).`));
    };
    xhr.onerror = () => reject(new Error("Direct upload failed: network interruption or storage CORS rejection. Check the provider CORS configuration; video bytes cannot be relayed through Erobabe."));
    xhr.ontimeout = () => reject(new Error("The upload timed out."));
    xhr.onabort = () => reject(new UploadAbortedError());

    const abort = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    xhr.addEventListener("loadend", cleanup, { once: true });
    if (options.signal?.aborted) { reject(new UploadAbortedError()); return; }
    options.signal?.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}
