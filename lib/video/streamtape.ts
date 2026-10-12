/**
 * Server-only Streamtape provider.
 *
 * The API login and key live exclusively in `STREAMTAPE_LOGIN` /
 * `STREAMTAPE_API_KEY` and are never returned to a browser, written to a log,
 * or copied into an error message. Credentials travel only as query parameters
 * on requests to `api.streamtape.com` (the documented auth mechanism) and are
 * redacted from every error this module produces.
 *
 * Endpoints, parameters and response envelopes implemented here were verified
 * against https://streamtape.com/api (fetched 2026-10-12). The upload-node
 * response body and CORS behaviour are *not* documented; they are proven by
 * `tests/live/streamtape.live.test.ts`, never assumed here — bytes go through
 * the streaming relay (`relay/streamtape-relay.mjs`), not through this class.
 */

import {
  STREAMTAPE_API_BASE,
  STREAMTAPE_REQUEST_TIMEOUT_MS,
  StreamtapeError,
  assertEnvelopeOk,
  assertStreamtapeIdentifier,
  parseEnvelope,
  parseFailedConverts,
  parseFileInfoResult,
  parseFolderListing,
  parseRunningConverts,
  parseSplashUrl,
  parseUploadUrlResult,
  redactSecrets,
  retryAfterSeconds,
  describeStreamtapeError,
  streamtapeEmbedUrl,
  type StreamtapeConvert,
  type StreamtapeFileInfo,
  type StreamtapeFolderFile,
  type StreamtapeRemoteTask,
} from "@/lib/video/streamtape-protocol";
import { parseRemoteAddResult, parseRemoteStatusResult } from "@/lib/video/streamtape-protocol";
import type { FileInfo, UploadResult, VideoProvider } from "@/lib/video/provider";

export type { StreamtapeFileInfo, StreamtapeFolderFile, StreamtapeRemoteTask, StreamtapeConvert };

/**
 * Fail-closed policy gate. Streamtape's Terms neither clearly permit nor ban
 * lawful consensual adult content, so the owner must verify the terms, the
 * copyright policy and the account's content settings before enabling uploads.
 * Until `STREAMTAPE_ADULT_CONTENT_ALLOWED=true` every upload, import and
 * completion is refused with an actionable message.
 */
export function streamtapeApprovalFlag(): boolean {
  return process.env.STREAMTAPE_ADULT_CONTENT_ALLOWED === "true";
}

export function streamtapeCredentials(): { login: string; key: string } | null {
  const login = (process.env.STREAMTAPE_LOGIN || "").trim();
  const key = (process.env.STREAMTAPE_API_KEY || "").trim();
  return login && key ? { login, key } : null;
}

/** The relay the browser must post bytes to, or null when unconfigured. */
export function streamtapeRelayUrl(): string | null {
  const raw = (process.env.STREAMTAPE_RELAY_URL || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function streamtapeRelaySecret(): string | null {
  const secret = (process.env.STREAMTAPE_RELAY_SECRET || "").trim();
  return secret || null;
}

/** Extra upload-node host suffixes the operator explicitly allowed. */
export function extraUploadHostSuffixes(): string[] {
  return (process.env.STREAMTAPE_UPLOAD_HOST_SUFFIXES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Largest file the app will attempt, in bytes. Streamtape's per-file ceiling is
 * not stated in the API docs; secondary sources claim 15 GB (2021). The default
 * matches that claim and must be re-checked against the account panel — it is
 * deliberately configurable so an unverified number is never hard-coded as
 * "the provider limit".
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024 * 1024;

export function streamtapeMaxUploadBytes(): number {
  const raw = Number(String(process.env.STREAMTAPE_MAX_UPLOAD_BYTES || "").trim());
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_MAX_UPLOAD_BYTES;
}

export type StreamtapeFolder = string | null;

export function streamtapeFolderId(): StreamtapeFolder {
  const raw = (process.env.STREAMTAPE_FOLDER_ID || "").trim();
  return raw || null;
}

export class StreamtapeProvider implements VideoProvider {
  name = "streamtape";

  isEnabled(): boolean {
    return Boolean(streamtapeCredentials()) && streamtapeApprovalFlag();
  }

  /** Why the provider is unavailable, phrased for an admin. */
  disabledReason(): string | null {
    if (this.isEnabled()) return null;
    if (!streamtapeCredentials()) {
      return "Set STREAMTAPE_LOGIN and STREAMTAPE_API_KEY (server-only) from the Streamtape account panel → Account Settings → API/FTP credentials.";
    }
    return "Streamtape uploads are disabled until STREAMTAPE_ADULT_CONTENT_ALLOWED=true is set after verifying Streamtape's terms, copyright policy and the account's content settings for this catalog.";
  }

  private credentials(): { login: string; key: string } {
    const credentials = streamtapeCredentials();
    if (!credentials) {
      throw new StreamtapeError(
        "Streamtape is not configured on the server. Add STREAMTAPE_LOGIN and STREAMTAPE_API_KEY to the deployment environment (never as NEXT_PUBLIC_* variables).",
        { status: 503, code: "missing_credentials" }
      );
    }
    return credentials;
  }

  /** Throws a fail-closed configuration error when uploads must not run. */
  assertEnabled(): void {
    if (!streamtapeCredentials()) {
      throw new StreamtapeError(
        "Streamtape uploads are not configured: STREAMTAPE_LOGIN / STREAMTAPE_API_KEY are missing. Add the server-only credentials from the account panel and redeploy.",
        { status: 503, code: "missing_credentials" }
      );
    }
    if (!streamtapeApprovalFlag()) {
      throw new StreamtapeError(
        "Streamtape uploads are disabled until the content-policy gate is recorded. Verify Streamtape's terms and copyright policy, confirm the account's content settings, set STREAMTAPE_ADULT_CONTENT_ALLOWED=true, then retry.",
        { status: 503, code: "provider_not_approved" }
      );
    }
  }

  /** Throws when the relay the browser needs is not configured. */
  assertRelayConfigured(): string {
    const relay = streamtapeRelayUrl();
    if (!relay) {
      throw new StreamtapeError(
        "STREAMTAPE_RELAY_URL is not set. Deploy relay/streamtape-relay.mjs (see DEPLOYMENT.md §D) and point STREAMTAPE_RELAY_URL at it — video bytes must never pass through Next.js.",
        { status: 503, code: "missing_relay" }
      );
    }
    if (!streamtapeRelaySecret() || (streamtapeRelaySecret() as string).length < 16) {
      throw new StreamtapeError(
        "STREAMTAPE_RELAY_SECRET must be set to a random string of at least 16 characters (same value in the app and the relay).",
        { status: 503, code: "missing_relay_secret" }
      );
    }
    return relay;
  }

  /**
   * One authenticated GET to the documented REST base.
   *
   * Both credentials are query parameters (the documented mechanism), so the
   * built URL is treated as secret material: it is never logged and every
   * error message passes through {@link redactSecrets} first.
   */
  private async request(
    path: string,
    query: Record<string, string | number | undefined | null> = {},
    timeoutMs: number = STREAMTAPE_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    const { login, key } = this.credentials();
    const url = new URL(`${STREAMTAPE_API_BASE}${path}`);
    url.searchParams.set("login", login);
    url.searchParams.set("key", key);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
    }

    const secrets = [key, login];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const aborted = (error as { name?: string })?.name === "AbortError";
      throw new StreamtapeError(
        aborted
          ? `Streamtape did not answer within ${Math.round(timeoutMs / 1000)}s. Retry; if it keeps timing out, check https://streamtape.com.`
          : "Network error while talking to Streamtape. Check the server's outbound connectivity and retry.",
        { status: 0, code: aborted ? "timeout" : "network_error" }
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      let envelope: ReturnType<typeof parseEnvelope> | null = null;
      if (payload !== null) {
        try {
          envelope = parseEnvelope(payload);
        } catch {
          envelope = null;
        }
      }
      const error =
        envelope && envelope.status !== 200
          ? describeStreamtapeError(envelope.status, envelope.msg)
          : new StreamtapeError(
              redactSecrets(
                `Streamtape request failed (HTTP ${response.status}).${envelope?.msg ? ` ${envelope.msg}` : text.trim() ? ` ${text.trim().slice(0, 200)}` : ""}`,
                secrets
              ),
              { status: response.status, code: `http_${response.status}` }
            );
      error.retryAfterSeconds = retryAfterSeconds(response.headers);
      error.message = redactSecrets(error.message, secrets);
      throw error;
    }

    if (payload === null) {
      throw new StreamtapeError(
        redactSecrets(text.trim() ? "Streamtape returned a response that was not valid JSON" : "Streamtape returned an empty response", secrets),
        { status: 502, code: "invalid_json" }
      );
    }

    // HTTP 200 does not mean success: the envelope's own status is the
    // authority. An upstream echo must never leak the login/key, so any
    // failure is redacted before it leaves this method.
    try {
      assertEnvelopeOk(parseEnvelope(payload));
    } catch (error: unknown) {
      if (error instanceof StreamtapeError) error.message = redactSecrets(error.message, secrets);
      throw error;
    }
    return payload;
  }

  // ----------------------------------------------------------------- account

  /**
   * `GET /account/info` — cheap authenticated reachability check used by
   * System Health. Returns nothing account-identifying: only latency and
   * success/failure are surfaced to the UI.
   */
  async checkAccount(): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      await this.request("/account/info");
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { ok: false, error: redactSecrets(message, [streamtapeCredentials()?.key, streamtapeCredentials()?.login]), latencyMs: Date.now() - startedAt };
    }
  }

  // ----------------------------------------------------------------- uploads

  /**
   * `GET /file/ul` — step 1 of the documented direct-upload flow. Returns the
   * node URL the browser (via the relay) must POST multipart bytes to.
   */
  async getUploadUrl(options: { folder?: string | null } = {}): Promise<{ url: string; validUntil: string | null }> {
    const folder = options.folder !== undefined ? options.folder : streamtapeFolderId();
    const payload = await this.request("/file/ul", {
      folder: folder || undefined,
      httponly: undefined, // https-only deployments: never ask for http nodes
    });
    return parseUploadUrlResult(payload, extraUploadHostSuffixes());
  }

  // ------------------------------------------------------------------- files

  /** `GET /file/info` — the file's conversion state, or null when unknown. */
  async fetchFileInfo(fileId: string): Promise<StreamtapeFileInfo | null> {
    const id = assertStreamtapeIdentifier(fileId);
    const payload = await this.request("/file/info", { file: id });
    return parseFileInfoResult(payload, id);
  }

  /** The app's provider-agnostic file view. */
  async getFileInfo(fileId: string): Promise<FileInfo> {
    const info = await this.fetchFileInfo(fileId);
    if (!info) {
      throw new StreamtapeError(
        `Streamtape no longer reports a file with id ${assertStreamtapeIdentifier(fileId)} (404). It may have been deleted from the account.`,
        { status: 404, code: "file_not_found" }
      );
    }
    const converted = info.converted && info.entryStatus === 200;
    return {
      fileId: info.id,
      title: info.name ?? undefined,
      status: converted ? 200 : info.entryStatus === 451 ? 500 : 202,
      canPlay: converted,
      fileSize: info.sizeBytes ?? undefined,
      providerStatus: converted ? "converted" : info.entryStatus === 451 ? "restricted" : "processing",
      errorMessage: info.entryStatus === 451 ? "Streamtape made this file unavailable for legal reasons (451)." : undefined,
    };
  }

  /** `GET /file/listfolder` (root or a folder) — used to reconcile uploads. */
  async listFolder(folder?: string | null): Promise<StreamtapeFolderFile[]> {
    const target = folder !== undefined ? folder : streamtapeFolderId();
    const payload = await this.request("/file/listfolder", { folder: target || undefined });
    return parseFolderListing(payload).files;
  }

  /** `GET /file/runningconverts` — queued/encoding jobs with progress. */
  async listRunningConverts(): Promise<StreamtapeConvert[]> {
    return parseRunningConverts(await this.request("/file/runningconverts"));
  }

  /** `GET /file/failedconverts` — conversions that ended in `error`. */
  async listFailedConverts(): Promise<StreamtapeConvert[]> {
    return parseFailedConverts(await this.request("/file/failedconverts"));
  }

  /**
   * `GET /file/getsplash` — stable thumbnail URL for a converted file.
   * Cosmetic: a failure never blocks a publish.
   */
  async getSplashUrl(fileId: string): Promise<string | null> {
    try {
      const payload = await this.request("/file/getsplash", { file: assertStreamtapeIdentifier(fileId) });
      return parseSplashUrl(payload);
    } catch (error: unknown) {
      console.warn(`[streamtape] getsplash failed: ${redactSecrets(error instanceof Error ? error.message : "unknown error", [
        streamtapeCredentials()?.key,
        streamtapeCredentials()?.login,
      ])}`);
      return null;
    }
  }

  /** `GET /file/rename` — cosmetic provider-side title; best effort. */
  async renameFile(fileId: string, name: string): Promise<boolean> {
    const trimmed = String(name || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!trimmed) return false;
    try {
      await this.request("/file/rename", { file: assertStreamtapeIdentifier(fileId), name: trimmed });
      return true;
    } catch (error: unknown) {
      console.warn(`[streamtape] rename failed: ${redactSecrets(error instanceof Error ? error.message : "unknown error", [
        streamtapeCredentials()?.key,
        streamtapeCredentials()?.login,
      ])}`);
      return false;
    }
  }

  /** `GET /file/delete` — removes a file from the account (live-test cleanup). */
  async deleteFile(fileId: string): Promise<boolean> {
    try {
      await this.request("/file/delete", { file: assertStreamtapeIdentifier(fileId) });
      return true;
    } catch (error: unknown) {
      if (error instanceof StreamtapeError && error.status === 404) return false;
      throw error;
    }
  }

  // ----------------------------------------------------------- remote imports

  /** `remotedl/add` — starts a remote download; answers with a *task*. */
  async addRemoteUpload(url: string, options: { name?: string; folder?: string | null } = {}): Promise<{ id: string; folderId: string | null }> {
    const folder = options.folder !== undefined ? options.folder : streamtapeFolderId();
    const payload = await this.request("/remotedl/add", {
      url,
      folder: folder || undefined,
      ...(options.name ? { name: options.name.slice(0, 200) } : {}),
    });
    return parseRemoteAddResult(payload);
  }

  /** `remotedl/status?id` — the task, or null when the provider has no record. */
  async getRemoteStatus(taskId: string): Promise<StreamtapeRemoteTask | null> {
    if (!taskId) return null;
    const payload = await this.request("/remotedl/status", { id: taskId });
    return parseRemoteStatusResult(payload, taskId);
  }

  /** `remotedl/remove?id` — cancels one task. Never `id=all`. */
  async removeRemoteUpload(taskId: string): Promise<boolean> {
    if (!taskId || taskId === "all") return false;
    try {
      const payload = await this.request("/remotedl/remove", { id: taskId });
      const envelope = assertEnvelopeOk(parseEnvelope(payload));
      return envelope.result === true;
    } catch (error: unknown) {
      if (error instanceof StreamtapeError && error.status === 404) return false;
      throw error;
    }
  }

  // -------------------------------------------------------------- addresses

  /** Stable, documented embed address — never a ticketed download link. */
  getEmbedUrl(fileId: string): string {
    return streamtapeEmbedUrl(fileId);
  }

  /**
   * Streamtape exposes no stable direct-media URL (downloads are ticketed and
   * expiring; the `/v/...` watch page form is undocumented without a name
   * segment). The documented playable address is the embed page, so that is
   * what is reported — the public page prefers `embed_url` anyway.
   */
  getPlayableUrl(fileId: string): string {
    return streamtapeEmbedUrl(fileId);
  }
}

/**
 * The provider the upload routes use, failing closed with an actionable
 * configuration error when the gate or credentials are missing.
 */
export function requireStreamtapeProvider(): StreamtapeProvider {
  const provider = new StreamtapeProvider();
  provider.assertEnabled();
  return provider;
}
