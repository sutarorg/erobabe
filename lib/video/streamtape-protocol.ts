/**
 * Streamtape protocol: constants, response parsing and pure helpers.
 *
 * Everything in this module is free of Node-only APIs and of environment
 * access, so the admin upload page can import it in the browser as well as the
 * server routes. Secrets never live here — the API login/key are read by
 * `lib/video/streamtape.ts`, which is server-only.
 *
 * Verified against the official documentation fetched on 2026-10-12:
 *   - https://streamtape.com/api            (endpoints, envelope, status codes)
 *   - https://streamtape.com/terms-and-conditions
 *   - https://streamtape.com/copyright
 * Community wrappers were used only as secondary corroboration. See
 * docs/STREAMTAPE_MIGRATION.md for the research log and the parts that still
 * require a live account (upload-node response body, CORS, field name).
 */

/** Documented REST base. All requests are GET (or POST) over HTTPS only. */
export const STREAMTAPE_API_BASE = "https://api.streamtape.com";

/**
 * Stable player addresses documented on https://streamtape.com/api
 * ("Custom Player Color" and subtitle examples use `/e/{fileId}`; watch links
 * are `/v/{fileId}/{name}`). Unlike download links (ticket + captcha), the
 * embed page never expires.
 */
export const STREAMTAPE_EMBED_BASE = "https://streamtape.com/e";
export const STREAMTAPE_WATCH_BASE = "https://streamtape.com/v";

/** Hosts the upload URL returned by `/file/ul` may legitimately point at. */
export const DEFAULT_UPLOAD_HOST_SUFFIXES = ["tapecontent.net", "streamtape.com"];

/** How long one control-plane request may take. */
export const STREAMTAPE_REQUEST_TIMEOUT_MS = 15_000;

export type AppUploadStatus = "processing" | "ready" | "failed";

/** `{status, msg, result}` — the envelope every documented endpoint returns. */
export interface StreamtapeEnvelope {
  status: number;
  msg: string | null;
  result: unknown;
}

export interface StreamtapeProviderErrorOptions {
  /** Envelope or HTTP status when the provider answered; 0 for network/parse. */
  status?: number;
  code?: string | null;
  retryAfterSeconds?: number | null;
}

/**
 * An error that is safe to show an admin: it never contains the API login or
 * key and always says what to do next.
 */
export class StreamtapeError extends Error {
  status: number;
  code: string | null;
  retryAfterSeconds: number | null;

  constructor(message: string, options: StreamtapeProviderErrorOptions = {}) {
    super(message);
    this.name = "StreamtapeError";
    this.status = options.status ?? 0;
    this.code = options.code ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

/**
 * Removes secrets (API key, API login, relay tokens) from a message before it
 * is logged, returned, or written to the audit log.
 */
export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (secret && secret.length >= 6) output = output.split(secret).join("[redacted]");
  }
  return output
    .replace(/(login|key|ticket|token)=[^&\s"']+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]");
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

/**
 * Parses the documented `{status, msg, result}` envelope.
 *
 * HTTP 200 does **not** mean success — the envelope's own `status` is the
 * authority (403 wrong key, 451 legal restriction, 509 bandwidth, …). An
 * envelope that is not an object, or carries a non-numeric status, is treated
 * as a malformed upstream response (502).
 */
export function parseEnvelope(payload: unknown): StreamtapeEnvelope {
  const body = asRecord(payload);
  if (!body) throw new StreamtapeError("Streamtape returned a response that is not a JSON object", { status: 502, code: "malformed_response" });
  const status = asNumber(body.status);
  if (status === null) {
    throw new StreamtapeError("Streamtape returned a response without a numeric status field", { status: 502, code: "malformed_response" });
  }
  return { status, msg: asString(body.msg), result: body.result ?? null };
}

/** Throws a described error when the envelope reports a failure. */
export function assertEnvelopeOk(envelope: StreamtapeEnvelope): StreamtapeEnvelope {
  if (envelope.status === 200) return envelope;
  throw describeStreamtapeError(envelope.status, envelope.msg);
}

/**
 * Turns an envelope/HTTP status plus the provider's message into an actionable
 * error. Based on the documented status table at https://streamtape.com/api.
 */
export function describeStreamtapeError(status: number, msg?: string | null, fallback?: string): StreamtapeError {
  const detail = String(msg || "").trim().slice(0, 300);
  const hints: Record<number, string> = {
    400: "Streamtape rejected the request (400). Check the parameters and try again.",
    403:
      "Streamtape denied the request (403). Verify STREAMTAPE_LOGIN and STREAMTAPE_API_KEY in the server environment (Account Settings → API/FTP credentials), and that the account owns this file.",
    404: "Streamtape could not find that file (404). It may have been deleted or never finished uploading.",
    451: "Streamtape made this file unavailable for legal reasons (451). Review the content and Streamtape's copyright policy before retrying.",
    509: "Streamtape's bandwidth quota is exhausted right now (509). Wait and retry later — this clears on its own, typically after off-peak hours.",
  };
  if (status >= 500 && status <= 599 && !hints[status]) {
    return new StreamtapeError(
      `Streamtape is having server trouble (${status}). Retry shortly.${detail ? ` ${detail}` : ""}`,
      { status, code: `http_${status}` }
    );
  }
  const hint = hints[status] || `Streamtape request failed (${status}).`;
  const composed = [hint, detail && detail !== hint ? detail : ""].filter(Boolean).join(" ");
  return new StreamtapeError(composed || fallback || `Streamtape request failed (${status}).`, {
    status,
    code: `http_${status}`,
  });
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

// ---------------------------------------------------------------- identifiers

/** An id we are willing to put into a public player address. */
export function isStreamtapeIdentifier(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(value.trim());
}

export function assertStreamtapeIdentifier(value: unknown, label = "Streamtape file id"): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!isStreamtapeIdentifier(raw)) {
    throw new StreamtapeError(`${label} is missing or malformed — refusing to build a player address from it.`, {
      status: 502,
      code: "bad_identifier",
    });
  }
  return raw;
}

/** `https://streamtape.com/e/{fileId}` — the documented stable embed page. */
export function streamtapeEmbedUrl(fileId: string): string {
  return `${STREAMTAPE_EMBED_BASE}/${assertStreamtapeIdentifier(fileId)}`;
}

/**
 * Validates an upload-node URL: HTTPS, no embedded credentials, and a host
 * under one of the provider's known suffixes (extendable via
 * `STREAMTAPE_UPLOAD_HOST_SUFFIXES`). SSRF defence in depth: the URL comes from
 * the provider, but a compromised/misrouted response must not be able to point
 * the relay at an arbitrary host.
 */
export function assertAllowedUploadHost(value: string, extraSuffixes: string[] = []): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StreamtapeError("Streamtape returned an upload URL that is not a valid URL", { status: 502, code: "bad_upload_url" });
  }
  if (url.protocol !== "https:") {
    throw new StreamtapeError("Streamtape returned an upload URL that is not HTTPS", { status: 502, code: "bad_upload_url" });
  }
  if (url.username || url.password) {
    throw new StreamtapeError("Streamtape returned an upload URL containing credentials", { status: 502, code: "bad_upload_url" });
  }
  const host = url.hostname.toLowerCase();
  const suffixes = [...DEFAULT_UPLOAD_HOST_SUFFIXES, ...extraSuffixes]
    .map((suffix) => suffix.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  const allowed = suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!allowed) {
    throw new StreamtapeError(
      `Streamtape returned an upload URL on an unexpected host (${host}). Expected one of: ${suffixes.join(", ")}. ` +
        `If Streamtape moved its nodes, extend STREAMTAPE_UPLOAD_HOST_SUFFIXES.`,
      { status: 502, code: "bad_upload_url" }
    );
  }
  return url.toString();
}

// ------------------------------------------------------------------- uploads

/** `GET /file/ul` → `result: { url, valid_until }`. */
export function parseUploadUrlResult(payload: unknown, extraHostSuffixes: string[] = []): { url: string; validUntil: string | null } {
  const envelope = assertEnvelopeOk(parseEnvelope(payload));
  const result = asRecord(envelope.result);
  const url = asString(result?.url);
  if (!url) {
    throw new StreamtapeError("Streamtape did not return an upload URL for this session", { status: 502, code: "missing_upload_url" });
  }
  return { url: assertAllowedUploadHost(url, extraHostSuffixes), validUntil: asString(result?.valid_until) };
}

/**
 * Tolerant parser for the **upload node's** response body.
 *
 * The node's exact response shape is not documented (verified 2026-10-12) and
 * is proven by the live suite (`tests/live/streamtape.live.test.ts`). Until a
 * candidate id is confirmed server-side via `/file/info`, nothing from this
 * parser is trusted for publication — see `lib/video/streamtape-flow.ts`.
 */
export interface NodeUploadResponse {
  /** Candidate file id when the body carries a plausible one. */
  fileId: string | null;
  /** `status` from the body when it is numeric (else null). */
  status: number | null;
  /** Human-readable message/body snippet, safe to show. */
  message: string;
}

const NODE_ID_KEYS = ["fileid", "file_id", "fileId", "id", "linkid", "link_id", "fid"];

export function parseNodeUploadResponse(body: unknown): NodeUploadResponse {
  const raw = typeof body === "string" ? body.trim() : "";
  if (!raw) return { fileId: null, status: null, message: "" };

  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (payload === null) {
    return { fileId: null, status: null, message: raw.replace(/\s+/g, " ").slice(0, 300) };
  }

  const record = asRecord(payload);
  const status = asNumber(record?.status);
  const message = asString(record?.msg) || asString(record?.message) || "";

  let fileId: string | null = null;
  const queue: unknown[] = [payload];
  let depth = 0;
  while (queue.length && depth < 4 && !fileId) {
    const current = asRecord(queue.shift());
    if (!current) continue;
    depth += 1;
    for (const key of NODE_ID_KEYS) {
      const candidate = asString(current[key]);
      if (candidate && isStreamtapeIdentifier(candidate)) {
        fileId = candidate;
        break;
      }
    }
    for (const nested of ["result", "data", "file", "upload"]) {
      if (current[nested] && typeof current[nested] === "object") queue.push(current[nested]);
    }
  }

  return {
    fileId,
    status: status === null ? null : Math.trunc(status),
    message: (message || raw.replace(/\s+/g, " ").slice(0, 300)).slice(0, 300),
  };
}

// --------------------------------------------------------------- file states

export interface StreamtapeFileInfo {
  id: string;
  name: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  /** Provider's conversion flag — `true` means the file is playable. */
  converted: boolean;
  /** The entry's own numeric status (200 OK per the documented examples). */
  entryStatus: number;
}

/**
 * `GET /file/info` — `result` is a **map keyed by file id** (documented).
 * Returns `null` when the map has no entry for the requested id (404 case).
 */
export function parseFileInfoResult(payload: unknown, fileId: string): StreamtapeFileInfo | null {
  const envelope = assertEnvelopeOk(parseEnvelope(payload));
  const id = assertStreamtapeIdentifier(fileId);
  const map = asRecord(envelope.result);
  if (!map) return null;
  const entry = asRecord(map[id]) ?? (asRecord(map) && asString((map as any).id) === id ? (map as any) : null);
  if (!entry) return null;

  const entryId = asString(entry.id) || id;
  const entryStatus = asNumber(entry.status) ?? 200;
  return {
    id: entryId,
    name: asString(entry.name),
    sizeBytes: asNumber(entry.size),
    mimeType: asString(entry.type),
    converted: entry.converted === true || entry.converted === "true" || entry.status === "converted",
    entryStatus: Math.trunc(entryStatus),
  };
}

export interface StreamtapeConvert {
  name: string | null;
  folderId: string | null;
  /** Raw provider status: `new`, `pending`, `error`, … (undocumented beyond these). */
  status: string | null;
  /** 0–1 progress as documented; normalized by callers. */
  progress: number | null;
  retries: number | null;
  linkId: string | null;
}

function parseConvertEntry(value: unknown): StreamtapeConvert | null {
  const entry = asRecord(value);
  if (!entry) return null;
  return {
    name: asString(entry.name),
    folderId: asString(entry.folderid) ?? asString(entry.folderId),
    status: asString(entry.status),
    progress: asNumber(entry.progress),
    retries: asNumber(entry.retries),
    linkId: asString(entry.linkid) ?? asString(entry.link_id),
  };
}

/** `GET /file/runningconverts` → `result` array. */
export function parseRunningConverts(payload: unknown): StreamtapeConvert[] {
  const envelope = assertEnvelopeOk(parseEnvelope(payload));
  const items = Array.isArray(envelope.result) ? envelope.result : [];
  return items.map(parseConvertEntry).filter((entry): entry is StreamtapeConvert => entry !== null);
}

/** `GET /file/failedconverts` → `result` array. */
export function parseFailedConverts(payload: unknown): StreamtapeConvert[] {
  const envelope = assertEnvelopeOk(parseEnvelope(payload));
  const items = Array.isArray(envelope.result) ? envelope.result : [];
  return items.map(parseConvertEntry).filter((entry): entry is StreamtapeConvert => entry !== null);
}

/** `GET /file/getsplash` → `result` is the splash URL string. */
export function parseSplashUrl(payload: unknown): string | null {
  const envelope = assertEnvelopeOk(parseEnvelope(payload));
  const url = asString(envelope.result);
  if (!url) return null;
  if (!/^https:\/\//i.test(url)) return null;
  return url;
}

/**
 * Maps a file's combined state onto the app's readiness vocabulary.
 *
 * `converted === true` (and entry status 200) is the **only** ready signal;
 * everything else is processing — except explicit provider failures (451 legal
 * restriction, 404 missing), which are failures. Conversion failure itself
 * comes from `/file/failedconverts`, checked by the flow.
 */
export function mapFileInfoReadiness(info: StreamtapeFileInfo): AppUploadStatus {
  if (info.converted && info.entryStatus === 200) return "ready";
  if (info.entryStatus === 451) return "failed";
  if (info.entryStatus === 404) return "failed";
  return "processing";
}

/** Provider-agnostic percent from the documented 0–1 progress value. */
export function convertProgressPercent(progress: number | null | undefined): number | null {
  if (progress === null || progress === undefined || !Number.isFinite(Number(progress))) return null;
  const value = Number(progress);
  // Values arrive as 0–1 (0.75); tolerate already-absolute percents too.
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(99, Math.round(percent)));
}

// ------------------------------------------------------------ folder listing

export interface StreamtapeFolderFile {
  name: string | null;
  sizeBytes: number | null;
  link: string | null;
  linkId: string | null;
  convert: string | null;
  createdAtMs: number | null;
  downloads: number | null;
}

/** `GET /file/listfolder` → `result: { folders, files }`. */
export function parseFolderListing(payload: unknown): { files: StreamtapeFolderFile[]; folders: Array<{ id: string; name: string | null }> } {
  const envelope = assertEnvelopeOk(parseEnvelope(payload));
  const result = asRecord(envelope.result) || {};
  const files = (Array.isArray(result.files) ? result.files : [])
    .map((item: unknown) => {
      const entry = asRecord(item);
      if (!entry) return null;
      const createdAt = asNumber(entry.created_at);
      return {
        name: asString(entry.name),
        sizeBytes: asNumber(entry.size),
        link: asString(entry.link),
        linkId: asString(entry.linkid) ?? asString(entry.link_id),
        convert: asString(entry.convert),
        createdAtMs: createdAt !== null ? Math.trunc(createdAt) : null,
        downloads: asNumber(entry.downloads),
      } satisfies StreamtapeFolderFile;
    })
    .filter((entry): entry is StreamtapeFolderFile => entry !== null);

  const folders = (Array.isArray(result.folders) ? result.folders : [])
    .map((item: unknown) => {
      const entry = asRecord(item);
      const id = asString(entry?.id);
      return id ? { id, name: asString(entry?.name) } : null;
    })
    .filter((entry): entry is { id: string; name: string | null } => entry !== null);

  return { files, folders };
}

/**
 * Picks the single unclaimed file that matches an upload: exact name and size
 * (when known) inside a freshness window. Returns `null` on zero or ambiguous
 * matches — the caller keeps the row private rather than guessing.
 */
export function selectUnclaimedFile(
  files: StreamtapeFolderFile[],
  match: { name: string; sizeBytes?: number | null; notClaimed: (linkId: string) => boolean; windowMs?: number; now?: number }
): StreamtapeFolderFile | null {
  const now = match.now ?? Date.now();
  const windowMs = match.windowMs ?? 30 * 60 * 1000;
  const wantedName = String(match.name || "").trim().toLowerCase();

  const candidates = files.filter((file) => {
    if (!file.linkId || !isStreamtapeIdentifier(file.linkId)) return false;
    if (!match.notClaimed(file.linkId)) return false;
    if (!file.name || file.name.trim().toLowerCase() !== wantedName) return false;
    if (match.sizeBytes != null && file.sizeBytes != null && Number(file.sizeBytes) !== Number(match.sizeBytes)) return false;
    if (file.createdAtMs != null && Math.abs(now - file.createdAtMs) > windowMs) return false;
    return true;
  });

  if (candidates.length !== 1) return null;
  return candidates[0];
}

// --------------------------------------------------------------- remote tasks

export interface StreamtapeRemoteTask {
  id: string;
  remoteUrl: string | null;
  status: string | null;
  bytesLoaded: number | null;
  bytesTotal: number | null;
  folderId: string | null;
  added: string | null;
  lastUpdate: string | null;
  /** Provider's external id — set when the import produced a file (per docs). */
  extid: string | false | null;
  /** Provider's URL — set when the import produced a file (per docs). */
  url: string | false | null;
}

/** `remotedl/add` → `result: { id, folderid }`. */
export function parseRemoteAddResult(payload: unknown): { id: string; folderId: string | null } {
  const envelope = assertEnvelopeOk(parseEnvelope(payload));
  const result = asRecord(envelope.result);
  const id = asString(result?.id);
  if (!id) {
    throw new StreamtapeError("Streamtape did not return a remote-upload task id", { status: 502, code: "missing_remote_id" });
  }
  return { id, folderId: asString(result?.folderid) };
}

function parseRemoteTask(value: unknown, taskId: string): StreamtapeRemoteTask | null {
  const entry = asRecord(value);
  if (!entry) return null;
  const id = asString(entry.id) || taskId;
  if (id !== taskId) return null;
  return {
    id,
    remoteUrl: asString(entry.remoteurl),
    status: asString(entry.status),
    bytesLoaded: asNumber(entry.bytes_loaded),
    bytesTotal: asNumber(entry.bytes_total),
    folderId: asString(entry.folderid),
    added: asString(entry.added),
    lastUpdate: asString(entry.last_update),
    extid: entry.extid === false || typeof entry.extid === "string" ? entry.extid : null,
    url: entry.url === false || typeof entry.url === "string" ? entry.url : null,
  };
}

/**
 * `remotedl/status` → `result` is a map keyed by the task id (documented).
 * Also tolerates an array shape (some mirrors show lists).
 */
export function parseRemoteStatusResult(payload: unknown, taskId: string): StreamtapeRemoteTask | null {
  const envelope = assertEnvelopeOk(parseEnvelope(payload));
  if (Array.isArray(envelope.result)) {
    for (const item of envelope.result) {
      const task = parseRemoteTask(item, taskId);
      if (task) return task;
    }
    return null;
  }
  const map = asRecord(envelope.result);
  if (!map) return null;
  if (map[taskId]) return parseRemoteTask(map[taskId], taskId);
  // Some deployments key the map by folder id — accept a single entry that
  // carries the requested task id.
  const values = Object.values(map);
  if (values.length === 1) return parseRemoteTask(values[0], taskId);
  return null;
}

/** Statuses that mean the remote task is still working (or not yet started). */
const REMOTE_PROCESSING_STATUSES = new Set([
  "new",
  "queued",
  "pending",
  "started",
  "starting",
  "running",
  "loading",
  "downloading",
  "download",
  "transfer",
]);

const REMOTE_FAILED_STATUSES = new Set(["error", "failed", "cancelled", "canceled", "removed", "expired", "dead"]);
const REMOTE_DONE_STATUSES = new Set(["done", "finished", "complete", "completed", "success", "uploaded"]);

export type RemoteTaskState = "processing" | "done" | "failed";

/**
 * The task's overall state. A queued/new task is **never** proof of
 * publication: `done` only when the provider reports a finished status *or*
 * carries the produced file references (`extid`/`url`), so the caller then
 * resolves the real file id and still waits for conversion.
 */
export function mapRemoteTaskState(task: StreamtapeRemoteTask): RemoteTaskState {
  const status = (task.status || "").trim().toLowerCase();
  if (REMOTE_FAILED_STATUSES.has(status)) return "failed";
  const hasFileRefs = Boolean((typeof task.extid === "string" && task.extid) || (typeof task.url === "string" && task.url));
  if (hasFileRefs) return "done";
  if (REMOTE_DONE_STATUSES.has(status)) return "done";
  if (REMOTE_PROCESSING_STATUSES.has(status)) return "processing";
  // Unknown vocabulary (undocumented upstream) → keep waiting, never publish.
  return "processing";
}

/**
 * Extracts a file id from the URL a finished remote task reports (watch links
 * are `https://streamtape.com/v/{fileId}/{name}`). Returns null when the value
 * is not a usable watch URL — the caller falls back to folder reconciliation.
 */
export function fileIdFromWatchUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "v") return null;
    const candidate = segments[1];
    return isStreamtapeIdentifier(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
