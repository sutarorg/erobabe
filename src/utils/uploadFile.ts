/**
 * Browser → object-storage uploader with real progress events.
 *
 * `fetch()` cannot report upload progress, and pushing large files through one
 * of our own API routes hits the 4.5 MB request-body limit that Vercel enforces
 * on functions (the source of the old
 * `Unexpected token 'R', "Request En"... is not valid JSON` failure). The admin
 * UI therefore asks the server for a short-lived signed URL and PUTs the bytes
 * straight to Supabase Storage with XHR, which does report progress.
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

export function uploadWithProgress(url: string, body: File | Blob, options: UploadOptions = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();

    xhr.open("PUT", url, true);
    // Supabase Storage infers the stored content type from this header.
    xhr.setRequestHeader("Content-Type", options.contentType || body.type || "application/octet-stream");
    for (const [name, value] of Object.entries(options.headers || {})) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (!options.onProgress || !event.lengthComputable) return;
      const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.001);
      options.onProgress({
        loaded: event.loaded,
        total: event.total || body.size,
        percent: event.total ? Math.min(100, (event.loaded / event.total) * 100) : 0,
        bytesPerSecond: event.loaded / elapsed,
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.({ loaded: body.size, total: body.size, percent: 100, bytesPerSecond: null });
        resolve();
        return;
      }
      reject(new Error(`Storage rejected the upload (${xhr.status || "no response"}).`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading — the connection to storage dropped."));
    xhr.ontimeout = () => reject(new Error("The upload timed out."));
    xhr.onabort = () => reject(new UploadAbortedError());

    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
