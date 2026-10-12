/**
 * UFOLOAD protocol: constants, response parsing and pure helpers.
 *
 * Everything in this module is free of Node-only APIs and of environment
 * access, so the admin upload page can import it in the browser as well as the
 * server routes. Secrets never live here — the API key is read by
 * `lib/video/ufoload.ts`, which is server-only.
 *
 * Verified against the official documentation and OpenAPI contract:
 *   - https://ufoload.com/docs/api
 *   - https://ufoload.com/api/openapi.json
 * (see IMPLEMENTATION_REPORT.md for the exact fields that were verified)
 */

/** Documented REST base, `Authorization: Bearer <key>`. */
export const UFOLOAD_API_BASE = "https://ufoload.com/api/v1";

/**
 * Stable player addresses. Both accept the file's ULID `id` and its short
 * 11-character `public_id`; neither expires, unlike the signed playback links
 * returned by `GET /files/{fileID}`.
 */
export const UFOLOAD_EMBED_BASE = "https://ufoload.com/e";
export const UFOLOAD_WATCH_BASE = "https://ufoload.com/v";

/** Documented hard ceiling for one direct-upload chunk (256 MiB). */
export const UFOLOAD_MAX_CHUNK_BYTES = 256 * 1024 * 1024;

/** `GET /files/uploads/{id}` keeps the concurrent-upload slot alive. */
export const UFOLOAD_KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;

export type UfoloadFileStatus = "uploading" | "queued" | "processing" | "ready" | "failed";
export type UfoloadImportStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type UfoloadUploadState = "pending" | "completing" | "completed" | "failed" | "aborted";

export type AppUploadStatus = "processing" | "ready" | "failed";

export interface UfoloadFile {
  /** ULID, the primary provider file identifier. */
  id: string;
  /** Short 11-character public identifier when the response carries one. */
  publicId: string | null;
  name: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  status: UfoloadFileStatus;
  progress: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  maxQuality: number | null;
  views: number | null;
  error: string | null;
  posterUrl: string | null;
  createdAt: string | null;
  duplicate: boolean;
}

export interface UfoloadLinkSet {
  playback: string | null;
  poster: string | null;
  download: string | null;
  expiresAt: string | null;
}

export interface UfoloadUploadGrant {
  uploadId: string;
  /** Complete node URL returned by UFOLOAD — never constructed locally. */
  url: string;
  /** Ready-made `Authorization` header value for node requests (grant). */
  authorization: string;
  chunkSize: number;
  maxBytes: number | null;
  expiresAt: string | null;
}

export interface UfoloadUploadStatePayload {
  state: UfoloadUploadState;
  fileId: string | null;
}

export interface UfoloadImportTask {
  id: string;
  url: string | null;
  name: string | null;
  status: UfoloadImportStatus;
  progress: number | null;
  error: string | null;
  /** Present only once the import finished: the created file's id. */
  fileId: string | null;
  createdAt: string | null;
}

export interface UfoloadProviderErrorOptions {
  /** HTTP status when the provider answered; 0 for network/parse failures. */
  status?: number;
  code?: string | null;
  requestId?: string | null;
  retryAfterSeconds?: number | null;
}

/**
 * An error that is safe to show an admin: it never contains the API key and
 * always says what to do next.
 */
export class UfoloadError extends Error {
  status: number;
  code: string | null;
  retryAfterSeconds: number | null;

  constructor(message: string, options: UfoloadProviderErrorOptions = {}) {
    super(message);
    this.name = "UfoloadError";
    this.status = options.status ?? 0;
    this.code = options.code ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

/**
 * Removes the API key (and any other secret) from a message before it is
 * logged, returned, or written to the audit log.
 */
export function redactSecret(text: string, secret?: string | null): string {
  let output = String(text ?? "");
  if (secret && secret.length >= 8) output = output.split(secret).join("[redacted]");
  return output
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    // Defence in depth: even if the configured key never reaches this helper,
    // an `ufo_...` token pasted into an upstream message must not be echoed.
    .replace(/\bufo_[A-Za-z0-9._~+/=-]{8,}/gi, "[redacted]");
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** The ISO date a response reported, or null when it is missing/unparseable. */
export function asIsoDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

/** `POST /files/uploads` — 201 body. */
export function parseUploadGrant(payload: unknown): UfoloadUploadGrant {
  const body = asRecord(payload);
  const uploadId = asString(body?.upload_id);
  const url = asString(body?.url);
  const authorization = asString(body?.authorization);

  if (!uploadId) throw new UfoloadError("UFOLOAD did not return an upload id for this session", { status: 502 });
  if (!url) throw new UfoloadError("UFOLOAD did not return an upload node URL for this session", { status: 502 });
  if (!authorization) throw new UfoloadError("UFOLOAD did not return an upload grant for this session", { status: 502 });
  if (!/^https:\/\//i.test(url)) {
    throw new UfoloadError("UFOLOAD returned an upload node URL that is not HTTPS", { status: 502 });
  }

  const chunkSize = asNumber(body?.chunk_size);
  if (!chunkSize || chunkSize <= 0) {
    throw new UfoloadError("UFOLOAD did not advertise a usable chunk size for this session", { status: 502 });
  }

  return {
    uploadId,
    url,
    authorization,
    chunkSize: Math.min(chunkSize, UFOLOAD_MAX_CHUNK_BYTES),
    maxBytes: asNumber(body?.max_bytes),
    expiresAt: asIsoDate(body?.expires_at),
  };
}

/** `GET /files/uploads/{id}` — direct-upload state (also the keep-alive). */
export function parseUploadState(payload: unknown): UfoloadUploadStatePayload {
  const body = asRecord(payload);
  const raw = asString(body?.state) || "";
  const allowed: UfoloadUploadState[] = ["pending", "completing", "completed", "failed", "aborted"];
  if (!allowed.includes(raw as UfoloadUploadState)) {
    throw new UfoloadError(`UFOLOAD reported an unknown upload state ("${raw || "missing"}")`, { status: 502 });
  }
  return { state: raw as UfoloadUploadState, fileId: asString(body?.file_id) };
}

/**
 * A `File` object from the REST v1 contract. The rest of this app only needs
 * the fields below; unknown extra fields are ignored on purpose so a provider
 * addition cannot break uploads.
 */
export function parseUfoloadFile(payload: unknown, options: { duplicate?: boolean } = {}): UfoloadFile {
  const body = asRecord(payload);
  const id = asString(body?.id);
  if (!body || !id) throw new UfoloadError("UFOLOAD returned a file without an id", { status: 502 });

  const status = asString(body.status) as UfoloadFileStatus | null;
  const allowed: UfoloadFileStatus[] = ["uploading", "queued", "processing", "ready", "failed"];
  if (!status || !allowed.includes(status)) {
    throw new UfoloadError(`UFOLOAD returned an unknown file status ("${asString(body.status) || "missing"}")`, { status: 502 });
  }

  // `public_id` is documented as a valid file identifier (11 characters) even
  // though the REST `File` schema does not list it as a property. Use it when
  // the response actually carries one — never invent it.
  const publicId = pickPublicIdentifier(body);

  const durationMs = asNumber(body.duration_ms);

  return {
    id,
    publicId,
    name: asString(body.name),
    sizeBytes: asNumber(body.size),
    mimeType: asString(body.mime_type),
    status,
    progress: asNumber(body.progress),
    durationSeconds: durationMs !== null && durationMs >= 0 ? Math.round(durationMs / 1000) : null,
    width: asNumber(body.width),
    height: asNumber(body.height),
    maxQuality: asNumber(body.max_quality),
    views: asNumber(body.views),
    error: asString(body.error),
    posterUrl: asString(body.poster),
    createdAt: asIsoDate(body.created_at),
    duplicate: options.duplicate === true,
  };
}

/** `{ file, duplicate }` as returned by upload, complete and file reads. */
export function parseFileEnvelope(payload: unknown): UfoloadFile {
  const body = asRecord(payload);
  return parseUfoloadFile(body?.file ?? payload, { duplicate: body?.duplicate === true });
}

/** `GET /files/{fileID}` — `{ file, links }`; links are short-lived. */
export function parseFileWithLinks(payload: unknown): { file: UfoloadFile; links: UfoloadLinkSet } {
  const body = asRecord(payload);
  const links = asRecord(body?.links);
  return {
    file: parseFileEnvelope(payload),
    links: {
      playback: asString(links?.playback),
      poster: asString(links?.poster),
      download: asString(links?.download),
      expiresAt: asIsoDate(links?.expires_at),
    },
  };
}

/** `{ import: Import }` from `POST /files/import`. */
export function parseImportEnvelope(payload: unknown): UfoloadImportTask {
  const body = asRecord(payload);
  return parseImportTask(body?.import ?? payload);
}

export function parseImportTask(payload: unknown): UfoloadImportTask {
  const body = asRecord(payload);
  const id = asString(body?.id);
  const status = asString(body?.status) as UfoloadImportStatus | null;
  const allowed: UfoloadImportStatus[] = ["queued", "running", "done", "failed", "cancelled"];

  if (!body || !id) throw new UfoloadError("UFOLOAD did not return an import task id", { status: 502 });
  if (!status || !allowed.includes(status)) {
    throw new UfoloadError(`UFOLOAD reported an unknown import status ("${asString(body.status) || "missing"}")`, { status: 502 });
  }

  return {
    id,
    url: asString(body.url),
    name: asString(body.name),
    status,
    progress: asNumber(body.progress),
    error: asString(body.error),
    fileId: asString(body.file_id),
    createdAt: asIsoDate(body.created_at),
  };
}

/** `GET /files/import` — the list an import is reconciled against. */
export function parseImportList(payload: unknown): UfoloadImportTask[] {
  const body = asRecord(payload);
  const items = Array.isArray(body?.items) ? body.items : Array.isArray(payload) ? payload : [];
  const tasks: UfoloadImportTask[] = [];
  for (const item of items) {
    try {
      tasks.push(parseImportTask(item));
    } catch {
      // One malformed entry must not hide the tasks around it.
    }
  }
  return tasks;
}

/** `{ items, total, limit, offset }` from `GET /files`. */
export function parseFileList(payload: unknown): UfoloadFile[] {
  const body = asRecord(payload);
  const items = Array.isArray(body?.items) ? body.items : [];
  const files: UfoloadFile[] = [];
  for (const item of items) {
    try {
      files.push(parseUfoloadFile(item));
    } catch {
      // Ignore unusable entries rather than failing the whole reconciliation.
    }
  }
  return files;
}

/** Provider error envelope: `{ error: { code, message, details } }`. */
export function extractUfoloadError(payload: unknown): { code: string | null; message: string | null; reason: string | null } {
  const body = asRecord(payload);
  const error = asRecord(body?.error);
  const details = asRecord(error?.details);
  return {
    code: asString(error?.code) ?? asString(body?.code),
    message: asString(error?.message) ?? asString(body?.message) ?? asString(body?.error),
    reason: asString(details?.reason),
  };
}

const STATUS_HINTS: Record<number, string> = {
  400: "UFOLOAD rejected the request (400).",
  401: "UFOLOAD rejected the API key (401). Check UFOLOAD_API_KEY in the server environment — the key must be a live `ufo_...` key from the UFOLOAD dashboard (Developers section).",
  402: "The UFOLOAD account has a negative balance (402), so new uploads are closed. Top up the balance in the UFOLOAD dashboard.",
  404: "UFOLOAD could not find that resource (404). The file or upload session may have been deleted or expired.",
  409: "UFOLOAD refused the operation (409). The account storage quota is full, the file already used its quota, or the upload is still finishing.",
  413: "This file is larger than the UFOLOAD plan allows (413). Check the plan's maximum file size or upload a smaller file.",
  429: "UFOLOAD rate-limited the request (429). Wait a moment and try again.",
  503: "UFOLOAD is temporarily unable to accept this request (503). Direct upload may be disabled — retry shortly.",
};

/**
 * Turns an HTTP status plus the provider's error envelope into an actionable
 * message. Known conditions get a specific hint; everything else keeps the
 * provider's own wording.
 */
export function describeUfoloadError(status: number, payload: unknown, fallback?: string): UfoloadError {
  const { code, message, reason } = extractUfoloadError(payload);

  if (status === 503 && (code === "direct_upload_unavailable" || reason === "direct_upload_unavailable")) {
    return new UfoloadError(
      "UFOLOAD direct upload is unavailable right now (503 direct_upload_unavailable). Pass the file to the server upload fallback or retry when direct upload is back.",
      { status, code }
    );
  }
  if (status === 429 && (code === "too_many_active" || reason === "too_many_active")) {
    return new UfoloadError("UFOLOAD already has the maximum number of active imports for this account. Wait for one to finish and try again.", {
      status,
      code,
    });
  }
  if (status === 409 && code === "upload_busy") {
    return new UfoloadError("UFOLOAD is still finishing the previous completion call for this upload. Retrying in a moment.", { status, code });
  }

  const hint = STATUS_HINTS[status];
  const detail = message && message !== hint ? message : "";
  const composed = [hint || `UFOLOAD request failed (${status}).`, detail].filter(Boolean).join(" ");
  return new UfoloadError(composed || fallback || `UFOLOAD request failed (${status}).`, { status, code });
}

/** Reads `Retry-After` — seconds or an HTTP date — when the provider sent one. */
export function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
  return null;
}

/**
 * The identifier the player addresses: the short `public_id` when the provider
 * actually returned one, otherwise the ULID `id` (also a documented `fileID`).
 */
export function pickPublicIdentifier(raw: unknown): string | null {
  const body = asRecord(raw);
  for (const key of ["public_id", "publicId", "file_code"]) {
    const candidate = asString(body?.[key]);
    if (candidate && isUfoloadIdentifier(candidate) && candidate.length <= 32) return candidate;
  }
  return null;
}

/** An id we are willing to put into a public player address. */
export function isUfoloadIdentifier(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(value.trim());
}

export function assertUfoloadIdentifier(value: unknown, label = "UFOLOAD file id"): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!isUfoloadIdentifier(raw)) {
    throw new UfoloadError(`${label} is missing or malformed — refusing to build a player address from it.`, { status: 502 });
  }
  return raw;
}

/** `https://ufoload.com/e/{identifier}` — the documented stable embed page. */
export function ufoloadEmbedUrl(identifier: string): string {
  return `${UFOLOAD_EMBED_BASE}/${assertUfoloadIdentifier(identifier)}`;
}

/** `https://ufoload.com/v/{identifier}` — the public watch page. */
export function ufoloadWatchUrl(identifier: string): string {
  return `${UFOLOAD_WATCH_BASE}/${assertUfoloadIdentifier(identifier)}`;
}

/** The stable player address for a stored file, preferring the public id. */
export function ufoloadPlayerIdentifier(file: Pick<UfoloadFile, "id" | "publicId">): string {
  return file.publicId && isUfoloadIdentifier(file.publicId) ? file.publicId : assertUfoloadIdentifier(file.id);
}

/** Maps a provider status onto the app's own provider status vocabulary. */
export function mapUfoloadStatus(status: UfoloadFileStatus): AppUploadStatus {
  switch (status) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    default:
      return "processing";
  }
}

export interface ChunkPlanOptions {
  /** Total size of the file in bytes. */
  size: number;
  /** Byte offset the provider has already accepted. */
  offset?: number;
  /** `chunk_size` from the upload grant. */
  chunkSize: number;
  /** `max_bytes` from the upload grant, when the provider sent one. */
  maxBytes?: number | null;
}

export interface ChunkPlan {
  /** Offset of the next chunk. */
  offset: number;
  /** Length of the next chunk (0 when the file is already fully transferred). */
  length: number;
  /** True when there is nothing left to send. */
  done: boolean;
}

/**
 * Plans the next chunk from the provider's own parameters. Never exceeds
 * `chunk_size`, the documented 256 MiB ceiling, the file size, or `max_bytes`.
 */
export function planNextChunk({ size, offset = 0, chunkSize, maxBytes = null }: ChunkPlanOptions): ChunkPlan {
  const total = Math.floor(Number(size));
  const start = Math.floor(Number(offset));
  if (!Number.isFinite(total) || total < 0) throw new UfoloadError("Cannot plan an upload for an unknown file size", { status: 500 });
  if (!Number.isFinite(start) || start < 0) throw new UfoloadError("Cannot plan an upload from a negative offset", { status: 500 });

  const ceiling = [chunkSize, UFOLOAD_MAX_CHUNK_BYTES]
    .filter((value) => Number.isFinite(value) && Number(value) > 0)
    .reduce((min, value) => Math.min(min, Math.floor(Number(value))), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    throw new UfoloadError("UFOLOAD did not advertise a usable chunk size for this upload", { status: 502 });
  }

  if (start >= total) return { offset: total, length: 0, done: true };

  const allowedTotal = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0 ? Math.min(total, Math.floor(Number(maxBytes))) : total;
  const length = Math.max(0, Math.min(ceiling, allowedTotal - start));
  return { offset: start, length, done: length === 0 };
}

/** Whole percent of the bytes actually transferred. Never rounds up to 100 early. */
export function uploadPercent(uploadedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, uploadedBytes / totalBytes));
  return Math.min(100, Math.floor(ratio * 100));
}

/**
 * Reconciles where to resume after an interruption.
 *
 * `accepted` is the offset the provider reported (or the last offset the
 * provider acknowledged); `sent` is how much of the local file was handed to
 * the network. The provider's number always wins, so a chunk that was only
 * partially received is re-sent instead of being skipped.
 */
export function reconcileResumeOffset({
  accepted,
  sent,
  total,
}: {
  /** The offset the node reported, as a number or a raw numeric string. */
  accepted: number | string | null | undefined;
  /** The offset the transport believed it had sent. */
  sent: number | string | null | undefined;
  total: number;
}): number {
  const size = Math.max(0, Math.floor(Number(total) || 0));
  // `null` and `""` must mean "the provider told us nothing", not "offset 0" —
  // Number(null) is 0, which would silently throw away a resumable position.
  const reported = accepted === null || accepted === undefined || accepted === "" ? Number.NaN : Number(accepted);
  const candidate = Number.isFinite(reported) ? Math.floor(reported) : Math.floor(Number(sent) || 0);
  if (!Number.isFinite(candidate) || candidate < 0) return 0;
  return Math.min(candidate, size);
}

/** `{"offset": N}` from the upload node's resume endpoint. */
export function parseAcceptedOffset(payload: unknown): number | null {
  const body = asRecord(payload);
  const offset = asNumber(body?.offset);
  return offset !== null && offset >= 0 ? Math.floor(offset) : null;
}
