/**
 * UFOLOAD — the platform's video upload and hosting provider.
 *
 * Verified against UFOLOAD's published contract on 2026-10-12:
 *   - https://ufoload.com/docs/api              (REST v1 guide)
 *   - https://ufoload.com/api/openapi.json      (REST v1 OpenAPI 3.1 — the contract this file follows)
 *   - https://ufoload.com/api/openapi-papi.json (public "papi" — only used to read the stable embed code)
 *
 * Everything here is SERVER-ONLY. `UFOLOAD_API_KEY` is read from the process
 * environment per request, sent only as `Authorization: Bearer …` to
 * `ufoload.com` / `api.ufoload.com`, and never returned, logged or stored. The
 * browser only ever receives the short-lived upload *grant* UFOLOAD issues for
 * one upload, and uses it against the exact `url` UFOLOAD returned.
 *
 * Nothing in this file constructs an upload-node URL, guesses a field, or
 * persists an expiring signed playback link: signed `links.*` / `poster`
 * values in UFOLOAD responses are deliberately ignored.
 */

import { ProviderApiError, VideoProviderConfigError, type ProviderConfigCode } from "@/lib/video/errors";
import { UFOLOAD_MAX_ACTIVE_IMPORTS, UFOLOAD_MAX_CHUNK_BYTES } from "@/lib/video/limits";
import { isPublicHostname } from "@/lib/video/url-safety";

export const UFOLOAD_API_BASE = "https://ufoload.com/api/v1";
/** Public API (`X-API-Key` / Bearer). Only used to read `filecode` + `protected_embed`. */
export const UFOLOAD_PUBLIC_API_BASE = "https://api.ufoload.com";
/** Documented embed URL shape: `https://ufoload.com/e/{public_id}`. */
export const UFOLOAD_EMBED_ORIGIN = "https://ufoload.com";
export const UFOLOAD_EMBED_PATH_PREFIX = "/e/";

const PROVIDER = "ufoload";

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** `complete` makes UFOLOAD verify size + sha256 with the node, so it gets longer. */
export const COMPLETE_REQUEST_TIMEOUT_MS = 55_000;
export const DEFAULT_MAX_RETRIES = 2;
/** Never sleep longer than this inside a request, whatever `Retry-After` says. */
const MAX_INLINE_RETRY_AFTER_SECONDS = 5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type UfoloadFileStatus = "uploading" | "queued" | "processing" | "ready" | "failed";
export type UfoloadImportStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type UfoloadUploadState = "pending" | "completing" | "completed" | "failed" | "aborted";

/** What the provider says about a hosted file — reduced to what the app needs. */
export interface ProviderFile {
  /** UFOLOAD's file identifier (`file.id`). This is what `provider_file_id` stores. */
  id: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  /** Raw provider status string. */
  status: string;
  /** Normalised: only an explicit `ready` is ever `ready`. Unknown statuses stay `processing`. */
  state: "processing" | "ready" | "failed";
  /** 0–100 as reported by UFOLOAD. */
  progress: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Frame height of the best ready quality. */
  maxQuality: number | null;
  /** Provider failure reason (`file.error`), when UFOLOAD supplies one. */
  error: string | null;
  /** Short public identifier — only when the response actually contains one. */
  publicId: string | null;
  /** A verified `https://ufoload.com/e/{id}` URL, only when the response carried a valid one. */
  embedUrl: string | null;
}

/** A URL-import task (`POST/GET /api/v1/files/import`). Its `id` is NOT a file id. */
export interface ImportTask {
  id: string;
  url: string | null;
  name: string | null;
  status: string;
  /** Normalised: unknown statuses are treated as still running, never as done. */
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  /** Appears only once the import is `done`. */
  fileId: string | null;
  createdAt: string | null;
}

/** The grant for one direct upload — exactly what the browser needs and nothing else. */
export interface DirectUploadGrant {
  uploadId: string;
  /** The complete node URL UFOLOAD returned. Never rebuilt, never cached across uploads. */
  url: string;
  /** Ready-made `Authorization` header value for the node (`UfoGrant …`). */
  authorization: string;
  chunkSize: number;
  maxBytes: number;
  expiresAt: string | null;
}

export interface DirectUploadStatus {
  state: string;
  fileId: string | null;
}

export interface CompletedUpload {
  file: ProviderFile;
  duplicate: boolean;
}

export interface VideoProvider {
  readonly name: string;
  /** What is missing or wrong with the configuration (empty `problems` = ready). Never contains a secret. */
  readiness(): { enabled: boolean; problems: Array<{ code: ProviderConfigCode; message: string }> };
  /** True only when the API key is present AND the adult-content approval flag is `true`. */
  isEnabled(): boolean;
  /** Throws {@link VideoProviderConfigError} naming everything that is missing. */
  assertEnabled(): void;
  createDirectUpload(input: { filename: string; size: number; mimeType?: string | null }): Promise<DirectUploadGrant>;
  getDirectUploadState(uploadId: string): Promise<DirectUploadStatus>;
  cancelDirectUpload(uploadId: string): Promise<void>;
  completeDirectUpload(uploadId: string, expected?: { size?: number; sha256?: string }): Promise<CompletedUpload>;
  startImport(input: { url: string; name?: string | null }): Promise<ImportTask>;
  listImports(): Promise<ImportTask[]>;
  findImport(taskId: string): Promise<ImportTask | null>;
  cancelImport(taskId: string): Promise<void>;
  getFile(fileId: string): Promise<ProviderFile>;
  resolveEmbedUrl(file: ProviderFile): Promise<string | null>;
  deleteFile(fileId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Identifier + embed helpers
// ---------------------------------------------------------------------------

/** `public_id` / `filecode` is 11 characters (OpenAPI `FileID`, papi `FileInfo.filecode`). */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isUfoloadPublicId(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_ID_PATTERN.test(value);
}

/** Builds the documented embed URL from a validated public id. Throws on anything else — never guesses. */
export function ufoloadEmbedUrl(publicId: string): string {
  if (!isUfoloadPublicId(publicId)) throw new Error("Not a valid UFOLOAD public id");
  return `${UFOLOAD_EMBED_ORIGIN}${UFOLOAD_EMBED_PATH_PREFIX}${publicId}`;
}

/** Returns the public id inside a `https://ufoload.com/e/{id}` URL, or null for anything else. */
export function parseUfoloadEmbedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.origin !== UFOLOAD_EMBED_ORIGIN || url.username || url.password || url.search || url.hash) return null;
  if (!url.pathname.startsWith(UFOLOAD_EMBED_PATH_PREFIX)) return null;
  const id = url.pathname.slice(UFOLOAD_EMBED_PATH_PREFIX.length);
  return isUfoloadPublicId(id) ? id : null;
}

export function isUfoloadEmbedUrl(value: unknown): value is string {
  return parseUfoloadEmbedUrl(value) !== null;
}

// ---------------------------------------------------------------------------
// Parsers — strict about what the app depends on, tolerant about everything else
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function clampPercent(value: unknown): number {
  const number = asInteger(value);
  if (number === null) return 0;
  return Math.max(0, Math.min(100, number));
}

function invalidResponse(operation: string, what: string): ProviderApiError {
  return new ProviderApiError({
    provider: PROVIDER,
    operation,
    status: 502,
    code: "invalid_response",
    message: `UFOLOAD returned an unexpected response during ${operation}: ${what}. The integration may need updating — check https://ufoload.com/docs/api.`,
    retryable: false,
  });
}

/** The ready-made header must be plain printable ASCII: it goes into a request header verbatim. */
function isSafeHeaderValue(value: string): boolean {
  return /^[\x20-\x7E]+$/.test(value) && value.length <= 4096;
}

/**
 * The node URL is taken whole from UFOLOAD's response. These checks only make
 * sure it is something the browser can safely send a grant to — they do not
 * rebuild or rewrite it.
 */
export function assertUploadNodeUrl(value: string, operation = "UFOLOAD upload initialization"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidResponse(operation, "the upload URL is not a valid URL");
  }
  if (url.protocol !== "https:") throw invalidResponse(operation, "the upload URL is not https");
  if (url.username || url.password) throw invalidResponse(operation, "the upload URL contains credentials");
  if (!isPublicHostname(url.hostname)) throw invalidResponse(operation, "the upload URL does not point to a public host");
  return url.toString();
}

export function parseUploadGrant(body: unknown, operation = "UFOLOAD upload initialization"): DirectUploadGrant {
  const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uploadId = asString(data.upload_id);
  const url = asString(data.url);
  const grant = asString(data.grant);
  const authorization = asString(data.authorization) ?? (grant ? `UfoGrant ${grant}` : null);
  const chunkSize = asInteger(data.chunk_size);
  const maxBytes = asInteger(data.max_bytes);

  if (!uploadId) throw invalidResponse(operation, "missing upload_id");
  if (!url) throw invalidResponse(operation, "missing url");
  if (!authorization || !isSafeHeaderValue(authorization)) throw invalidResponse(operation, "missing or unusable authorization grant");
  if (chunkSize === null || chunkSize <= 0) throw invalidResponse(operation, "missing chunk_size");
  if (maxBytes === null || maxBytes <= 0) throw invalidResponse(operation, "missing max_bytes");

  const expiresRaw = asString(data.expires_at);
  const expiresAt = expiresRaw && Number.isFinite(Date.parse(expiresRaw)) ? expiresRaw : null;

  return {
    uploadId,
    url: assertUploadNodeUrl(url, operation),
    authorization,
    // The node never accepts more than 256 MiB per request, whatever chunk_size says.
    chunkSize: Math.min(chunkSize, UFOLOAD_MAX_CHUNK_BYTES),
    maxBytes,
    expiresAt,
  };
}

export function parseFile(raw: unknown, operation = "UFOLOAD file lookup"): ProviderFile {
  if (!raw || typeof raw !== "object") throw invalidResponse(operation, "no file object");
  const data = raw as Record<string, unknown>;
  const id = asString(data.id);
  if (!id) throw invalidResponse(operation, "the file has no id");

  const status = asString(data.status) ?? "processing";
  const state: ProviderFile["state"] = status === "ready" ? "ready" : status === "failed" ? "failed" : "processing";

  // `public_id` is how the OpenAPI names the short id ("ULID or short public_id (11 characters)");
  // papi calls the same value `filecode`. Take whichever the response actually carries.
  const publicIdCandidate = data.public_id ?? data.filecode ?? data.file_code;
  const embed = asString(data.protected_embed);

  return {
    id,
    name: asString(data.name) ?? "",
    size: asInteger(data.size),
    mimeType: asString(data.mime_type),
    status,
    state,
    progress: state === "ready" ? 100 : clampPercent(data.progress),
    durationMs: asInteger(data.duration_ms),
    width: asInteger(data.width),
    height: asInteger(data.height),
    maxQuality: asInteger(data.max_quality),
    error: asString(data.error),
    publicId: isUfoloadPublicId(publicIdCandidate) ? publicIdCandidate : null,
    embedUrl: embed && isUfoloadEmbedUrl(embed) ? embed : null,
  };
}

const IMPORT_STATES = new Set<ImportTask["state"]>(["queued", "running", "done", "failed", "cancelled"]);

export function parseImport(raw: unknown, operation = "UFOLOAD import"): ImportTask {
  if (!raw || typeof raw !== "object") throw invalidResponse(operation, "no import object");
  const data = raw as Record<string, unknown>;
  const id = asString(data.id);
  if (!id) throw invalidResponse(operation, "the import task has no id");

  const status = asString(data.status) ?? "queued";
  // An unknown status is treated as "still running": it must never be mistaken for done.
  const state = IMPORT_STATES.has(status as ImportTask["state"]) ? (status as ImportTask["state"]) : "running";

  return {
    id,
    url: asString(data.url),
    name: asString(data.name),
    status,
    state,
    progress: state === "done" ? 100 : clampPercent(data.progress),
    error: asString(data.error),
    fileId: asString(data.file_id),
    createdAt: asString(data.created_at),
  };
}

// ---------------------------------------------------------------------------
// Error text — written for the admin / operator, never containing a secret
// ---------------------------------------------------------------------------

type OperationKind =
  | "init"
  | "state"
  | "cancel-upload"
  | "complete"
  | "import-start"
  | "import-list"
  | "import-cancel"
  | "file"
  | "file-delete"
  | "embed-info";

const OPERATION_LABEL: Record<OperationKind, string> = {
  init: "UFOLOAD upload initialization",
  state: "UFOLOAD upload status check",
  "cancel-upload": "UFOLOAD upload cancellation",
  complete: "UFOLOAD upload completion",
  "import-start": "UFOLOAD URL import",
  "import-list": "UFOLOAD import status check",
  "import-cancel": "UFOLOAD import cancellation",
  file: "UFOLOAD file status check",
  "file-delete": "UFOLOAD file deletion",
  "embed-info": "UFOLOAD embed lookup",
};

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(3600, Number(trimmed));
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return Math.max(0, Math.min(3600, Math.ceil((date - Date.now()) / 1000)));
  return null;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export interface UfoloadProviderOptions {
  /** Defaults to `process.env`, read lazily so the key is never cached at import time. */
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
}

interface CallInit {
  method?: "GET" | "POST" | "DELETE";
  json?: unknown;
  base?: "rest" | "papi";
  timeoutMs?: number;
  /** Idempotent reads retry on 429/5xx/timeouts; writes never do unless asked. */
  retry?: boolean;
}

export class UfoloadProvider implements VideoProvider {
  readonly name = PROVIDER;

  private readonly envSource: Record<string, string | undefined> | null;
  private readonly fetchImpl?: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: UfoloadProviderOptions = {}) {
    this.envSource = options.env ?? null;
    this.fetchImpl = options.fetchImpl;
    this.sleepImpl = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  // -- configuration -------------------------------------------------------

  private env(name: string): string | undefined {
    return (this.envSource ?? process.env)[name];
  }

  private apiKey(): string | null {
    const key = this.env("UFOLOAD_API_KEY")?.trim();
    return key ? key : null;
  }

  /** What is missing or wrong with the configuration, in the order an operator should fix it. */
  readiness(): { enabled: boolean; problems: Array<{ code: ProviderConfigCode; message: string }> } {
    const problems: Array<{ code: ProviderConfigCode; message: string }> = [];
    if (this.env("UFOLOAD_ADULT_CONTENT_APPROVED") !== "true") {
      problems.push({
        code: "adult_content_not_approved",
        message:
          'UFOLOAD_ADULT_CONTENT_APPROVED is not "true". Written approval from UFOLOAD is required before any adult content is uploaded: set the flag only after UFOLOAD has confirmed in writing that lawful adult content, commercial use, API upload and embedded playback are permitted (see DEPLOYMENT.md).',
      });
    }
    const key = this.apiKey();
    if (!key) {
      problems.push({
        code: "api_key_missing",
        message: "UFOLOAD_API_KEY is not set. Create a key in the UFOLOAD dashboard (Developers → API keys) and add it to the server environment only.",
      });
    } else if (/\s/.test(key) || !/^[\x21-\x7E]+$/.test(key)) {
      problems.push({
        code: "api_key_malformed",
        message: "UFOLOAD_API_KEY contains whitespace or non-ASCII characters. Re-paste the key without surrounding spaces or line breaks.",
      });
    }
    return { enabled: problems.length === 0, problems };
  }

  isEnabled(): boolean {
    return this.readiness().enabled;
  }

  assertEnabled(): void {
    const { enabled, problems } = this.readiness();
    if (enabled) return;
    const summary = problems.map((problem) => problem.message).join(" ");
    throw new VideoProviderConfigError(
      problems[0].code,
      "UFOLOAD uploads are not enabled on this server.",
      summary
    );
  }

  /** Cleanup calls (cancel/delete) only need the key — they must keep working if approval is withdrawn. */
  private requireKey(): string {
    const key = this.apiKey();
    if (!key) {
      throw new VideoProviderConfigError(
        "api_key_missing",
        "UFOLOAD_API_KEY is not set on this server.",
        "Create a key in the UFOLOAD dashboard (Developers → API keys) and add it to the server environment only."
      );
    }
    if (/\s/.test(key) || !/^[\x21-\x7E]+$/.test(key)) {
      throw new VideoProviderConfigError(
        "api_key_malformed",
        "UFOLOAD_API_KEY is malformed.",
        "UFOLOAD_API_KEY contains whitespace or non-ASCII characters. Re-paste the key without surrounding spaces or line breaks."
      );
    }
    return key;
  }

  // -- transport -----------------------------------------------------------

  /** Removes anything that looks like a key from text that may be shown to an admin. */
  private sanitize(text: string): string {
    let clean = String(text ?? "");
    const key = this.apiKey();
    if (key) clean = clean.split(key).join("[redacted]");
    clean = clean.replace(/ufo_[A-Za-z0-9_-]{6,}/g, "[redacted]");
    // eslint-disable-next-line no-control-regex
    clean = clean.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return clean.length > 240 ? `${clean.slice(0, 237)}…` : clean;
  }

  private retryDelayMs(attempt: number, retryAfterSeconds: number | null): number {
    const jitter = Math.floor(this.random() * 100);
    if (retryAfterSeconds !== null) return Math.min(retryAfterSeconds, MAX_INLINE_RETRY_AFTER_SECONDS) * 1000 + jitter;
    return Math.min(250 * 2 ** (attempt - 1), 2000) + jitter;
  }

  private async call(kind: OperationKind, path: string, init: CallInit = {}): Promise<{ status: number; body: unknown }> {
    const operation = OPERATION_LABEL[kind];
    const apiKey = this.requireKey();
    const method = init.method ?? "GET";
    const base = init.base === "papi" ? UFOLOAD_PUBLIC_API_BASE : UFOLOAD_API_BASE;
    const retry = init.retry ?? method === "GET";
    const attempts = retry ? 1 + this.maxRetries : 1;

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
    let body: string | undefined;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }

    let lastError: ProviderApiError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.once(kind, operation, `${base}${path}`, { method, headers, body }, init.timeoutMs ?? this.timeoutMs);
      } catch (error) {
        if (!(error instanceof ProviderApiError)) throw error;
        lastError = error;
        if (!error.retryable || attempt === attempts) throw error;
        await this.sleepImpl(this.retryDelayMs(attempt, error.retryAfterSeconds));
      }
    }
    throw lastError ?? invalidResponse(operation, "no response");
  }

  private async once(
    kind: OperationKind,
    operation: string,
    url: string,
    request: { method: string; headers: Record<string, string>; body?: string },
    timeoutMs: number
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let text: string;
    try {
      const doFetch = this.fetchImpl ?? fetch;
      response = await doFetch(url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        cache: "no-store",
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderApiError({
          provider: PROVIDER,
          operation,
          status: 0,
          code: "timeout",
          message: `UFOLOAD did not answer within ${Math.round(timeoutMs / 1000)} seconds during ${operation}. Try again in a moment.`,
          retryable: true,
        });
      }
      throw new ProviderApiError({
        provider: PROVIDER,
        operation,
        status: 0,
        code: "network",
        message: `Could not reach UFOLOAD during ${operation}. Check the server's outbound network access to ufoload.com and try again.`,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    let json: unknown = null;
    if (text.trim()) {
      try {
        json = JSON.parse(text);
      } catch {
        if (response.ok) throw invalidResponse(operation, `HTTP ${response.status} with a body that is not valid JSON`);
        json = null;
      }
    }

    if (!response.ok) throw this.failure(kind, operation, response.status, json, response.headers);
    return { status: response.status, body: json };
  }

  /** Maps a non-2xx answer to an error whose message tells the admin what to do. */
  private failure(kind: OperationKind, operation: string, status: number, json: unknown, headers: Headers): ProviderApiError {
    const errorBody = ((json as Record<string, unknown> | null)?.error ?? null) as Record<string, unknown> | string | null;
    const providerCode = typeof errorBody === "object" && errorBody ? asString(errorBody.code) : null;
    const rawMessage =
      typeof errorBody === "object" && errorBody
        ? asString(errorBody.message)
        : typeof errorBody === "string"
          ? errorBody
          : asString((json as Record<string, unknown> | null)?.msg);
    const requestId = typeof errorBody === "object" && errorBody ? asString(errorBody.request_id) : null;
    const said = rawMessage ? ` UFOLOAD said: “${this.sanitize(rawMessage)}”.` : "";
    const retryAfter = parseRetryAfter(headers.get("retry-after"));

    const make = (
      code: ProviderApiError["code"],
      message: string,
      extra: { retryable?: boolean; retryAfterSeconds?: number | null } = {}
    ) =>
      new ProviderApiError({
        provider: PROVIDER,
        operation,
        status,
        code,
        message: `${message}${said}`,
        retryable: extra.retryable ?? false,
        retryAfterSeconds: extra.retryAfterSeconds ?? retryAfter,
        requestId,
      });

    if (status === 401) {
      return make(
        "unauthorized",
        "UFOLOAD rejected the API key (401). Check UFOLOAD_API_KEY in the server environment: it may be missing, revoked or copied incorrectly. Create a new key under UFOLOAD → Developers (it is shown only once)."
      );
    }
    if (status === 402) {
      return make("payment_required", "The UFOLOAD account balance is negative, so new uploads are closed (402). Top up the balance in the UFOLOAD dashboard.");
    }
    if (status === 403) {
      return make("forbidden", "UFOLOAD refused this request (403). The API key's account may lack upload permission.");
    }
    if (status === 404) {
      const text: Record<OperationKind, string> = {
        init: "UFOLOAD could not find the destination folder (404).",
        state: "UFOLOAD does not know this upload session (404). It expired — sessions are released 15 minutes after their last activity — or it was cancelled. Start the upload again.",
        "cancel-upload": "UFOLOAD does not know this upload session (404); there is nothing to cancel.",
        complete: "UFOLOAD does not know this upload session (404). It expired or was cancelled. Start the upload again.",
        "import-start": "UFOLOAD could not find the destination folder for the import (404).",
        "import-list": "UFOLOAD could not list imports (404).",
        "import-cancel": "UFOLOAD does not know this import task (404).",
        file: "UFOLOAD has no file with this ID (404). It was deleted, removed by the Free plan's 30-day no-views rule, or blocked by moderation.",
        "file-delete": "UFOLOAD has no file with this ID (404).",
        "embed-info": "UFOLOAD has no file with this ID (404).",
      };
      return make("not_found", text[kind]);
    }
    if (status === 409) {
      if (providerCode === "upload_busy") {
        return make("upload_busy", "UFOLOAD is still finalizing the previous request for this upload (409 upload_busy). Retrying in a moment will work.", {
          retryable: true,
          retryAfterSeconds: retryAfter ?? 2,
        });
      }
      if (kind === "import-start") {
        return make(
          "too_many_imports",
          `UFOLOAD already has the maximum of ${UFOLOAD_MAX_ACTIVE_IMPORTS} active URL imports (409). Wait for one to finish — the admin page retries automatically.`,
          { retryable: true, retryAfterSeconds: retryAfter ?? 30 }
        );
      }
      if (kind === "cancel-upload") {
        return make("conflict", "This upload can no longer be cancelled (409): UFOLOAD is already finishing it.");
      }
      if (kind === "complete") {
        return make("conflict", "UFOLOAD could not finish this upload (409): the account is out of storage or the upload session is already closed.");
      }
      return make("conflict", "UFOLOAD reports not enough storage for this file (409). Free up space in the UFOLOAD dashboard or upgrade the plan.");
    }
    if (status === 413) {
      return make("payload_too_large", "UFOLOAD refused the file as too large for this account's plan (413).");
    }
    if (status === 429) {
      if (kind === "init") {
        return make(
          "rate_limited",
          "UFOLOAD's concurrent-upload limit for this plan is reached (429). Wait for running uploads to finish; an abandoned upload frees its slot 15 minutes after its last activity.",
          { retryable: true, retryAfterSeconds: retryAfter ?? 30 }
        );
      }
      return make(
        "rate_limited",
        `UFOLOAD is rate limiting requests (429)${retryAfter ? `; retry in ${retryAfter} seconds` : ""}.`,
        { retryable: true, retryAfterSeconds: retryAfter ?? 5 }
      );
    }
    if (status === 503 && providerCode === "direct_upload_unavailable") {
      return make(
        "direct_upload_unavailable",
        "UFOLOAD direct upload is temporarily unavailable (503 direct_upload_unavailable). The app does not fall back to sending the file through its own servers, because large videos cannot pass through a serverless function. Try again later.",
        { retryable: true, retryAfterSeconds: retryAfter ?? 60 }
      );
    }
    if (status === 400) {
      return make(
        "bad_request",
        kind === "import-start"
          ? "UFOLOAD rejected the link (400). It must be a direct, public http(s) link to a file — internal and loopback addresses are blocked."
          : `UFOLOAD rejected the request during ${operation} (400).`
      );
    }
    if (status >= 500) {
      return make("upstream_error", `UFOLOAD is having trouble (HTTP ${status}) during ${operation}. Try again shortly.`, { retryable: true });
    }
    return make("bad_request", `UFOLOAD answered ${operation} with an unexpected HTTP ${status}.`);
  }

  // -- direct upload -------------------------------------------------------

  async createDirectUpload(input: { filename: string; size: number; mimeType?: string | null }): Promise<DirectUploadGrant> {
    this.assertEnabled();
    const filename = String(input.filename || "").trim().slice(0, 255);
    if (!filename) throw new Error("A file name is required to start an upload");
    if (!Number.isInteger(input.size) || input.size <= 0) throw new Error("The exact file size in bytes is required to start an upload");

    const payload: Record<string, unknown> = { filename, size: input.size };
    if (input.mimeType) payload.mime_type = String(input.mimeType).slice(0, 200);

    const { body } = await this.call("init", "/files/uploads", { method: "POST", json: payload });
    const grant = parseUploadGrant(body);

    if (grant.maxBytes < input.size) {
      // The node would refuse the bytes — release the slot instead of leaving a dead session behind.
      await this.cancelDirectUpload(grant.uploadId).catch(() => {});
      throw new ProviderApiError({
        provider: PROVIDER,
        operation: OPERATION_LABEL.init,
        status: 413,
        code: "payload_too_large",
        message: `UFOLOAD's per-upload ceiling (max_bytes ${grant.maxBytes}) is smaller than this file (${input.size} bytes), so it would refuse the upload.`,
      });
    }
    return grant;
  }

  async getDirectUploadState(uploadId: string): Promise<DirectUploadStatus> {
    this.assertEnabled();
    const { body } = await this.call("state", `/files/uploads/${encodeURIComponent(uploadId)}`);
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const state = asString(data.state);
    if (!state) throw invalidResponse(OPERATION_LABEL.state, "missing state");
    return { state, fileId: asString(data.file_id) };
  }

  async cancelDirectUpload(uploadId: string): Promise<void> {
    await this.call("cancel-upload", `/files/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
  }

  async completeDirectUpload(uploadId: string, expected: { size?: number; sha256?: string } = {}): Promise<CompletedUpload> {
    this.assertEnabled();
    const payload: Record<string, unknown> = {};
    if (expected.size !== undefined && Number.isInteger(expected.size) && expected.size > 0) payload.size = expected.size;
    if (expected.sha256) payload.sha256 = expected.sha256;

    const { body } = await this.call("complete", `/files/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: "POST",
      json: payload,
      timeoutMs: COMPLETE_REQUEST_TIMEOUT_MS,
    });
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    return { file: parseFile(data.file, OPERATION_LABEL.complete), duplicate: data.duplicate === true };
  }

  // -- URL import ----------------------------------------------------------

  async startImport(input: { url: string; name?: string | null }): Promise<ImportTask> {
    this.assertEnabled();
    const payload: Record<string, unknown> = { url: input.url };
    if (input.name) payload.name = String(input.name).slice(0, 200);
    const { body } = await this.call("import-start", "/files/import", { method: "POST", json: payload });
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    return parseImport(data.import, OPERATION_LABEL["import-start"]);
  }

  async listImports(): Promise<ImportTask[]> {
    this.assertEnabled();
    const { body } = await this.call("import-list", "/files/import");
    const items = (body && typeof body === "object" ? (body as Record<string, unknown>).items : null) as unknown;
    if (!Array.isArray(items)) throw invalidResponse(OPERATION_LABEL["import-list"], "no items list");
    const tasks: ImportTask[] = [];
    for (const item of items) {
      try {
        tasks.push(parseImport(item, OPERATION_LABEL["import-list"]));
      } catch {
        // One malformed entry must not hide the others.
      }
    }
    return tasks;
  }

  /**
   * UFOLOAD has no single-task endpoint, so the task is found in the import
   * list by its actual id — never by URL, name or position.
   */
  async findImport(taskId: string): Promise<ImportTask | null> {
    const tasks = await this.listImports();
    return tasks.find((task) => task.id === taskId) ?? null;
  }

  async cancelImport(taskId: string): Promise<void> {
    await this.call("import-cancel", `/files/import/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  }

  // -- files ---------------------------------------------------------------

  /** `GET /files/{id}`. The response's signed `links` are discarded: they expire and must never be stored. */
  async getFile(fileId: string): Promise<ProviderFile> {
    this.assertEnabled();
    const { body } = await this.call("file", `/files/${encodeURIComponent(fileId)}`);
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    return parseFile(data.file, OPERATION_LABEL.file);
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.call("file-delete", `/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  }

  /**
   * The stable embed URL (`https://ufoload.com/e/{public_id}`), or null when
   * UFOLOAD has not given us an identifier we can verify.
   *
   * The REST `File` schema does not list a public id, so the lookup is:
   *   1. a valid id/embed URL carried by the REST response itself, else
   *   2. `GET https://api.ufoload.com/file/info?file_code={file.id}` (documented
   *      to accept the internal ULID) → `filecode` / `protected_embed`.
   * A value that is not exactly 11 URL-safe characters is rejected, so a ULID
   * or a half-parsed field can never end up in an iframe `src`.
   */
  async resolveEmbedUrl(file: ProviderFile): Promise<string | null> {
    if (file.embedUrl) return file.embedUrl;
    if (file.publicId) return ufoloadEmbedUrl(file.publicId);

    this.assertEnabled();
    const { body } = await this.call("embed-info", `/file/info?file_code=${encodeURIComponent(file.id)}`, { base: "papi" });
    const envelope = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const status = asInteger(envelope.status);
    if (status !== null && status !== 200) return null;
    const result = Array.isArray(envelope.result) ? envelope.result[0] : null;
    if (!result || typeof result !== "object") return null;
    const info = result as Record<string, unknown>;

    const filecode = info.filecode ?? info.file_code;
    if (!isUfoloadPublicId(filecode)) return null;
    const protectedEmbed = asString(info.protected_embed);
    if (protectedEmbed && parseUfoloadEmbedUrl(protectedEmbed) === filecode) return protectedEmbed;
    // `protected_embed` absent or pointing somewhere else: rebuild from the validated code only.
    return ufoloadEmbedUrl(filecode);
  }
}
