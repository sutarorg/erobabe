/**
 * Browser → provider upload helpers with real progress events.
 *
 * `fetch()` cannot report upload progress, and pushing large files through one
 * of our own API routes hits the 4.5 MB request-body limit that Vercel enforces
 * on functions (the source of the old
 * `Unexpected token 'R', "Request En"... is not valid JSON` failure). Large
 * files therefore go straight from the browser to the storage node UFOLOAD
 * hands out — thumbnails keep using a signed Supabase Storage URL.
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
// UFOLOAD direct upload: PUT one chunk at a time to the node URL the server
// returned, authenticated with the upload-scoped grant (never with the API key).
// ---------------------------------------------------------------------------

export interface ChunkUploadOptions {
  /** Headers for the node request — `Authorization: <grant>` from the session. */
  headers: Record<string, string>;
  signal?: AbortSignal;
  /** Bytes of *this chunk* reported by the browser as they leave. */
  onProgress?: (loadedInChunk: number, chunkSize: number, bytesPerSecond: number | null) => void;
}

export interface ChunkUploadResponse {
  status: number;
  body: string;
}

/**
 * Uploads one chunk to `url?offset=N`.
 *
 * XHR is used (not `fetch`) because it reports byte-level progress — the number
 * the admin sees is measured, not estimated. `Content-Length` is set by the
 * browser from the Blob, which is what the node requires; the code must never
 * try to set it manually (it is a forbidden header name).
 */
export function putUploadChunk(
  url: string,
  offset: number,
  chunk: Blob,
  options: ChunkUploadOptions
): Promise<ChunkUploadResponse> {
  return new Promise<ChunkUploadResponse>((resolve, reject) => {
    let xhr: XMLHttpRequest;
    try {
      xhr = new XMLHttpRequest();
    } catch {
      reject(new Error("This browser cannot upload video files directly. Try a current version of Chrome, Firefox, Edge or Safari."));
      return;
    }

    const target = new URL(url);
    target.searchParams.set("offset", String(offset));

    xhr.open("PUT", target.toString(), true);
    xhr.withCredentials = false;
    xhr.responseType = "text";
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    for (const [name, value] of Object.entries(options.headers || {})) {
      // `Content-Length` and friends are set by the browser and must not be
      // written here — setting them is ignored at best and a hard error at worst.
      if (/^(content-length|host|connection)$/i.test(name)) continue;
      xhr.setRequestHeader(name, value);
    }

    const startedAt = Date.now();
    xhr.upload.onprogress = (event) => {
      if (!options.onProgress || !event.lengthComputable) return;
      const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.001);
      options.onProgress(event.loaded, event.total || chunk.size, event.loaded / elapsed);
    };
    xhr.upload.onload = () => options.onProgress?.(chunk.size, chunk.size, null);

    xhr.onload = () => {
      const body = typeof xhr.responseText === "string" ? xhr.responseText : "";
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ status: xhr.status, body });
        return;
      }
      reject(new Error(describeNodeError(xhr.status, body)));
    };
    xhr.onerror = () =>
      reject(new Error("Network error while sending a chunk to UFOLOAD — the upload node did not answer."));
    xhr.ontimeout = () => reject(new Error("A chunk upload timed out."));
    xhr.onabort = () => reject(new UploadAbortedError());

    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(chunk);
  });
}

/** Turns the upload node's error body into something an admin can act on. */
export function describeNodeError(status: number, body: string): string {
  let detail = "";
  try {
    const json = JSON.parse(body);
    detail = typeof json?.error?.message === "string" ? json.error.message : typeof json?.message === "string" ? json.message : "";
  } catch {
    detail = String(body || "").trim().slice(0, 200);
  }

  const hints: Record<number, string> = {
    400: "The upload node rejected the chunk (400). Start the upload again.",
    401: "The upload grant was rejected — the session or its signature expired. Start the upload again.",
    403: "The upload node refused the grant (403). The session may have been cancelled or expired.",
    409: "The chunk offset did not match what the node received (409). The upload will resume from the accepted offset.",
    410: "The upload grant expired. Start the upload again.",
    413: "The upload node refused the chunk as too large (413).",
    429: "The upload node is rate-limiting this upload (429). Retry in a moment.",
    503: "The upload node is temporarily unavailable (503). Retry in a moment.",
  };

  const hint = hints[status] || `The upload node rejected the chunk (${status}).`;
  return detail ? `${hint} ${detail}` : hint;
}

/**
 * Asks the upload node how many bytes it has actually accepted.
 *
 * The documented resume endpoint answers `{"offset": N}`; a chunk that was only
 * partially received is therefore re-sent instead of being skipped, and an
 * offset our own bookkeeping thought was sent can never hide missing data.
 */
export async function fetchAcceptedOffset(
  url: string,
  options: { headers: Record<string, string>; signal?: AbortSignal }
): Promise<number | null> {
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: options.headers, cache: "no-store", signal: options.signal });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw new UploadAbortedError();
    return null;
  }
  if (!response.ok) return null;
  try {
    const payload = await response.json();
    const offset = Number(payload?.offset);
    return Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : null;
  } catch {
    return null;
  }
}
