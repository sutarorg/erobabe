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

export function uploadWithProgress(url: string, body: File | Blob, options: UploadOptions = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", options.contentType || body.type || "application/octet-stream");
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
    xhr.onerror = () => reject(new Error("Network error while uploading — the connection to storage dropped."));
    xhr.ontimeout = () => reject(new Error("The upload timed out."));
    xhr.onabort = () => reject(new UploadAbortedError());

    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export interface DirectUploadOptions {
  signal?: AbortSignal;
}

export interface DirectUploadResult {
  /**
   * The upload server's response body — non-empty only when the response was
   * actually readable (same-origin proxy, or Uqload ever sends CORS headers).
   */
  responseText: string;
  /**
   * True when the request left the browser but the response could not be read
   * (cross-origin, no CORS headers). The upload may still have succeeded —
   * the caller must confirm it against the provider's file list.
   */
  needsConfirmation: boolean;
}

/**
 * Multipart POST straight to Uqload's upload server.
 *
 * ⚠️ No `xhr.upload` listeners and no custom headers may ever be added here.
 * Per the XMLHttpRequest standard, registering any listener on the `upload`
 * object sets the request's `use-CORS-preflight` flag, so the browser sends an
 * OPTIONS preflight before the POST. Uqload's upload servers do not implement
 * CORS, so that preflight is never answered and the browser cancels the upload
 * before a single byte is sent — surfacing as a "network error" even though
 * Uqload never even saw the request. A listener-less multipart POST with no
 * custom headers is a CORS "simple request", which browsers always deliver.
 *
 * Do not set Content-Type — the browser must supply the multipart boundary.
 *
 * Consequence: byte-level progress is impossible for a direct upload, and the
 * JSON response (with the filecode) is not readable because Uqload omits
 * CORS headers. The caller therefore shows an indeterminate progress state and
 * confirms the upload via the provider file list when `needsConfirmation` is
 * set.
 */
export function uploadFormDirect(url: string, form: FormData, options: DirectUploadOptions = {}): Promise<DirectUploadResult> {
  return new Promise<DirectUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", url, true);
    xhr.withCredentials = false;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ responseText: xhr.responseText || "", needsConfirmation: false });
        return;
      }
      // Readable error response — only reachable for same-origin (proxied)
      // uploads, since cross-origin responses without CORS headers surface
      // as onerror instead.
      let detail = "";
      try {
        const json = JSON.parse(xhr.responseText);
        if (json && typeof json.msg === "string") detail = json.msg;
      } catch {
        detail = "";
      }
      reject(new Error(`Uqload rejected the upload${xhr.status ? ` (${xhr.status})` : ""}${detail ? `: ${detail}` : ""}`));
    };
    xhr.onerror = () => {
      // Two very different cases land here: (a) the request was delivered but
      // the response is unreadable because Uqload omits CORS headers, and
      // (b) a genuine network failure. JavaScript cannot distinguish them, so
      // resolve with needsConfirmation and let the caller check the file list
      // — a file that is not there after the retry window truly failed.
      resolve({ responseText: "", needsConfirmation: true });
    };
    xhr.onabort = () => reject(new UploadAbortedError());

    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
