/**
 * Browser → storage upload helpers with real progress events.
 *
 * Used for thumbnail uploads to Supabase Storage. Video files are published
 * from direct URLs and never pass through Erobabe.
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

// ---------------------------------------------------------------------------
// Streamtape upload: one multipart POST from the browser to the streaming
// relay, which pipes it to the provider node. XHR (not fetch) because it
// reports byte-level progress — the number the admin sees is measured, and
// `xhr.abort()` genuinely cancels the transfer (the relay then aborts the
// upstream request and Streamtape drops the partial body).
// ---------------------------------------------------------------------------

export interface MultipartUploadResult {
  /** HTTP status of the upstream node's response, passed through by the relay. */
  status: number;
  /** Verbatim response body — parsed by the server during completion, never trusted directly. */
  body: string;
}

export interface MultipartUploadOptions extends UploadOptions {
  /** Multipart field name. The Streamtape docs' example uses `file1`. */
  fieldName?: string;
  /** Extra non-file fields to append before the file. */
  fields?: Record<string, string>;
}

/**
 * POSTs `file` as multipart/form-data to `url` with measured progress.
 *
 * Resolves for **any** HTTP status (including 4xx/5xx from the node) so the
 * caller can surface the provider's own message; rejects only on network
 * failure, timeout, or cancellation.
 */
export function uploadMultipartWithProgress(
  url: string,
  file: File | Blob,
  fileName: string,
  options: MultipartUploadOptions = {}
): Promise<MultipartUploadResult> {
  return new Promise<MultipartUploadResult>((resolve, reject) => {
    let xhr: XMLHttpRequest;
    try {
      xhr = new XMLHttpRequest();
    } catch {
      reject(new Error("This browser cannot upload video files. Try a current version of Chrome, Firefox, Edge or Safari."));
      return;
    }

    xhr.open("POST", url, true);
    xhr.withCredentials = false;
    xhr.responseType = "text";
    for (const [name, value] of Object.entries(options.headers || {})) {
      if (/^(content-length|host|connection|content-type)$/i.test(name)) continue;
      xhr.setRequestHeader(name, value);
    }
    attachProgress(xhr, file.size, options);

    xhr.onload = () => {
      const body = typeof xhr.responseText === "string" ? xhr.responseText : "";
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.({ loaded: file.size, total: file.size, percent: 100, bytesPerSecond: null });
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Network error while sending the video to the upload relay — the connection dropped, or the relay rejected the request. " +
            "Check STREAMTAPE_RELAY_URL and the relay's STREAMTAPE_RELAY_ALLOWED_ORIGINS, then try again."
        )
      );
    xhr.ontimeout = () => reject(new Error("The upload timed out. Check your connection and try again."));
    xhr.onabort = () => reject(new UploadAbortedError());

    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    const form = new FormData();
    for (const [name, value] of Object.entries(options.fields || {})) form.append(name, value);
    form.append(options.fieldName || "file1", file, fileName);
    xhr.send(form);
  });
}

/**
 * Turns a non-2xx upload-node/relay response into an admin-facing message.
 * The node's body is only used for display — status codes drive the branch.
 */
export function describeUploadEndpointError(status: number, body: string): string {
  let detail = "";
  try {
    const json = JSON.parse(body);
    detail = typeof json?.msg === "string" ? json.msg : typeof json?.message === "string" ? json.message : typeof json?.error === "string" ? json.error : "";
  } catch {
    detail = String(body || "").trim().replace(/\s+/g, " ").slice(0, 200);
  }

  const hints: Record<number, string> = {
    400: "The upload endpoint rejected the request (400). Start the upload again.",
    403: "The upload was refused (403). The session may have expired — start the upload again.",
    404: "The upload session no longer exists (404). Start the upload again from this page.",
    410: "The upload session expired (410). Start the upload again from this page.",
    413: "The upload is too large for the relay or the provider (413). Check STREAMTAPE_MAX_UPLOAD_BYTES and the account's real file-size limit.",
    429: "The endpoint is rate-limiting uploads (429). Wait a moment and retry.",
    500: "The upload endpoint failed on its side (500). Retry shortly.",
    502: "The relay could not reach the Streamtape upload node (502). Retry shortly.",
    503: "The upload endpoint is temporarily unavailable (503). Retry in a moment.",
    509: "Streamtape's bandwidth quota is exhausted right now (509). Wait and retry later.",
  };

  const hint = hints[status] || `The upload endpoint rejected the transfer (${status || "no response"}).`;
  return detail ? `${hint} ${detail}` : hint;
}
