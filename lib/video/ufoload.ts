/**
 * Server-only UFOLOAD provider.
 *
 * The API key lives exclusively in `UFOLOAD_API_KEY` and is never returned to a
 * browser, written to a log, or copied into an error message. Browser uploads
 * authenticate with the short-lived, upload-scoped grant that UFOLOAD hands out
 * in the initialization response — not with the API key.
 *
 * Endpoints, request fields and response fields implemented here were verified
 * against https://ufoload.com/docs/api and https://ufoload.com/api/openapi.json.
 */

import {
  UFOLOAD_API_BASE,
  UfoloadError,
  describeUfoloadError,
  extractUfoloadError,
  parseFileEnvelope,
  parseFileList,
  parseFileWithLinks,
  parseImportEnvelope,
  parseImportList,
  parseImportTask,
  parseUploadGrant,
  parseUploadState,
  redactSecret,
  retryAfterSeconds,
  ufoloadEmbedUrl,
  ufoloadWatchUrl,
  type UfoloadFile,
  type UfoloadImportTask,
  type UfoloadLinkSet,
  type UfoloadUploadGrant,
  type UfoloadUploadStatePayload,
} from "@/lib/video/ufoload-protocol";
import type { FileInfo, UploadResult, VideoProvider } from "@/lib/video/provider";

/** How long a single control-plane request to ufoload.com may take. */
export const UFOLOAD_REQUEST_TIMEOUT_MS = 15_000;

/**
 * The operator must confirm in writing that lawful adult content, commercial
 * use, API uploads and embedded playback are permitted before this provider is
 * enabled. Until `UFOLOAD_ADULT_CONTENT_APPROVED=true` is set the integration
 * fails closed: no upload session, no import, no completion.
 */
export function ufoloadApprovalFlag(): boolean {
  return process.env.UFOLOAD_ADULT_CONTENT_APPROVED === "true";
}

export function ufoloadApiKey(): string | null {
  const key = (process.env.UFOLOAD_API_KEY || "").trim();
  return key ? key : null;
}

export class UfoloadProvider implements VideoProvider {
  name = "ufoload";

  isEnabled(): boolean {
    return ufoloadApprovalFlag() && Boolean(ufoloadApiKey());
  }

  /** Why the provider is unavailable, phrased for an admin. */
  disabledReason(): string | null {
    if (this.isEnabled()) return null;
    if (!ufoloadApiKey()) {
      return "Set UFOLOAD_API_KEY (server-only) to the API key from the UFOLOAD dashboard — Developers section.";
    }
    return "Set UFOLOAD_ADULT_CONTENT_APPROVED=true only after UFOLOAD has confirmed in writing that lawful adult content, commercial use, API uploads and embedded playback are permitted.";
  }

  private getApiKey(): string {
    const key = ufoloadApiKey();
    if (!key) {
      throw new UfoloadError(
        "UFOLOAD_API_KEY is not configured on the server. Add it to the deployment environment (never as a NEXT_PUBLIC_* variable).",
        { status: 503, code: "missing_api_key" }
      );
    }
    return key;
  }

  /** Throws a fail-closed configuration error when uploads must not run. */
  assertEnabled(): void {
    if (!ufoloadApiKey()) {
      throw new UfoloadError(
        "UFOLOAD uploads are not configured: UFOLOAD_API_KEY is missing. Add the server-only API key and redeploy.",
        { status: 503, code: "missing_api_key" }
      );
    }
    if (!ufoloadApprovalFlag()) {
      throw new UfoloadError(
        "UFOLOAD uploads are disabled until the provider approval is recorded. Obtain written confirmation from UFOLOAD that lawful adult content, commercial use, API uploads and embedded playback are permitted, then set UFOLOAD_ADULT_CONTENT_APPROVED=true.",
        { status: 503, code: "provider_not_approved" }
      );
    }
  }

  /** One authenticated JSON request to the documented REST base. */
  private async request(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined>; timeoutMs?: number } = {}
  ): Promise<unknown> {
    const apiKey = this.getApiKey();
    const url = new URL(`${UFOLOAD_API_BASE}${path}`);
    for (const [name, value] of Object.entries(init.query || {})) {
      if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? UFOLOAD_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method || "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const aborted = (error as { name?: string })?.name === "AbortError";
      throw new UfoloadError(
        aborted
          ? `UFOLOAD did not answer within ${Math.round((init.timeoutMs ?? UFOLOAD_REQUEST_TIMEOUT_MS) / 1000)}s. Retry; if it keeps timing out, check the UFOLOAD status page.`
          : "Network error while talking to UFOLOAD. Check the server's outbound connectivity and retry.",
        { status: 0, code: aborted ? "timeout" : "network_error" }
      );
    } finally {
      clearTimeout(timeout);
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
      const error = describeUfoloadError(response.status, payload);
      error.retryAfterSeconds = retryAfterSeconds(response.headers);
      // Belt and braces: an upstream echo must never leak the key.
      error.message = redactSecret(error.message, apiKey);
      throw error;
    }

    if (payload === null && text.trim()) {
      throw new UfoloadError("UFOLOAD returned a response that was not valid JSON", { status: 502, code: "invalid_json" });
    }

    return payload;
  }

  // ---------------------------------------------------------------- uploads

  /** `POST /files/uploads` — step 1 of the documented direct-upload flow. */
  async initDirectUpload(request: { fileName: string; fileSize: number; mimeType?: string }): Promise<UfoloadUploadGrant> {
    this.assertEnabled();
    const payload = await this.request("/files/uploads", {
      method: "POST",
      body: {
        filename: request.fileName,
        size: Math.max(0, Math.floor(request.fileSize)),
        ...(request.mimeType ? { mime_type: request.mimeType } : {}),
      },
    });
    return parseUploadGrant(payload);
  }

  /** `GET /files/uploads/{id}` — state, and the documented keep-alive. */
  async getUploadState(uploadId: string): Promise<UfoloadUploadStatePayload> {
    this.assertEnabled();
    if (!uploadId) throw new UfoloadError("Missing upload id for the UFOLOAD upload-state request", { status: 400 });
    return parseUploadState(await this.request(`/files/uploads/${encodeURIComponent(uploadId)}`));
  }

  /**
   * `POST /files/uploads/{id}/complete` — step 3.
   *
   * `upload_busy` (409) means the node is still finalizing: retry briefly
   * instead of failing the upload the browser just finished sending.
   */
  async completeDirectUpload(
    uploadId: string,
    options: { size?: number; sha256?: string; attempts?: number; delayMs?: number } = {}
  ): Promise<UfoloadFile> {
    this.assertEnabled();
    const attempts = Math.max(1, options.attempts ?? 3);
    const delayMs = options.delayMs ?? 1500;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const payload = await this.request(`/files/uploads/${encodeURIComponent(uploadId)}/complete`, {
          method: "POST",
          body: {
            ...(Number.isFinite(options.size) ? { size: Math.floor(Number(options.size)) } : {}),
            ...(options.sha256 ? { sha256: options.sha256 } : {}),
          },
        });
        return parseFileEnvelope(payload);
      } catch (error) {
        lastError = error;
        if (!(error instanceof UfoloadError) || error.code !== "upload_busy" || attempt === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  }

  /** `DELETE /files/uploads/{id}` — cancel and free the concurrency slot. */
  async cancelDirectUpload(uploadId: string): Promise<boolean> {
    this.assertEnabled();
    try {
      await this.request(`/files/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
      return true;
    } catch (error) {
      // 404 = already gone, 409 = it finished while we cancelled; both fine.
      if (error instanceof UfoloadError && (error.status === 404 || error.status === 409)) return false;
      throw error;
    }
  }

  // ------------------------------------------------------------------ files

  /** `GET /files/{fileID}` — the file plus its (short-lived) signed links. */
  async getFileWithLinks(fileId: string): Promise<{ file: UfoloadFile; links: UfoloadLinkSet }> {
    this.assertEnabled();
    return parseFileWithLinks(await this.request(`/files/${encodeURIComponent(fileId)}`));
  }

  /** `GET /files/{fileID}` reduced to what the app stores and displays. */
  async getFile(fileId: string): Promise<UfoloadFile> {
    return (await this.getFileWithLinks(fileId)).file;
  }

  /**
   * The app's provider-agnostic file view.
   *
   * `status` is no longer a magic number: 200 means "the provider says this
   * file is playable", anything else means it is not (yet).
   */
  async getFileInfo(fileId: string): Promise<FileInfo> {
    const file = await this.getFile(fileId);
    return {
      fileId: file.id,
      title: file.name ?? undefined,
      status: file.status === "ready" ? 200 : file.status === "failed" ? 500 : 202,
      canPlay: file.status === "ready",
      thumbnailUrl: file.posterUrl ?? undefined,
      durationSeconds: file.durationSeconds ?? undefined,
      fileSize: file.sizeBytes ?? undefined,
      views: file.views ?? undefined,
      providerStatus: file.status,
      progress: file.progress ?? undefined,
      errorMessage: file.error ?? undefined,
      publicId: file.publicId ?? undefined,
    };
  }

  /** `DELETE /files/{fileID}` — 204 on success. */
  async deleteFile(fileId: string): Promise<boolean> {
    this.assertEnabled();
    try {
      await this.request(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
      return true;
    } catch (error) {
      if (error instanceof UfoloadError && error.status === 404) return false;
      throw error;
    }
  }

  /** `PATCH /files/{fileID}` — the provider-side title used on its own pages. */
  async renameFile(fileId: string, name: string): Promise<boolean> {
    this.assertEnabled();
    const trimmed = String(name || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!trimmed) return false;
    try {
      const payload = await this.request(`/files/${encodeURIComponent(fileId)}`, { method: "PATCH", body: { name: trimmed } });
      parseFileEnvelope(payload);
      return true;
    } catch (error) {
      if (error instanceof UfoloadError && error.status === 404) return false;
      // A rename is cosmetic: never fail an otherwise good publish because of it.
      console.warn(`[ufoload] rename failed: ${redactSecret((error as Error)?.message || "unknown error")}`);
      return false;
    }
  }

  /** `GET /files?status=...` — used to reconcile records that stayed processing. */
  async listFiles(options: { status?: string; limit?: number; offset?: number } = {}): Promise<UfoloadFile[]> {
    this.assertEnabled();
    return parseFileList(
      await this.request("/files", {
        query: { status: options.status, limit: options.limit, offset: options.offset },
      })
    );
  }

  // ----------------------------------------------------------------- imports

  /** `POST /files/import` — asynchronous URL import (202 + task). */
  async createImport(request: { url: string; name?: string }): Promise<UfoloadImportTask> {
    this.assertEnabled();
    const payload = await this.request("/files/import", {
      method: "POST",
      body: { url: request.url, ...(request.name ? { name: request.name.slice(0, 240) } : {}) },
    });
    return parseImportEnvelope(payload);
  }

  /** `GET /files/import` — the list the stored task id is matched against. */
  async listImports(): Promise<UfoloadImportTask[]> {
    this.assertEnabled();
    return parseImportList(await this.request("/files/import"));
  }

  /** Finds a task by its actual id, never by position in the list. */
  async findImport(importId: string): Promise<UfoloadImportTask | null> {
    const tasks = await this.listImports();
    return tasks.find((task) => task.id === importId) ?? null;
  }

  /** `DELETE /files/import/{id}` — cancel, or drop a finished task. */
  async cancelImport(importId: string): Promise<boolean> {
    this.assertEnabled();
    try {
      await this.request(`/files/import/${encodeURIComponent(importId)}`, { method: "DELETE" });
      return true;
    } catch (error) {
      if (error instanceof UfoloadError && error.status === 404) return false;
      throw error;
    }
  }

  // ------------------------------------------------------------ addresses

  /** Stable, documented embed address — never a signed playback link. */
  getEmbedUrl(fileId: string): string {
    return ufoloadEmbedUrl(fileId);
  }

  /** Stable public watch page (the signed HLS link expires; this does not). */
  getPlayableUrl(fileId: string): string {
    return ufoloadWatchUrl(fileId);
  }
}

/**
 * The provider used by the upload routes, or a fail-closed error when
 * `VIDEO_PROVIDER` points at something that is not UFOLOAD.
 */
export function requireUfoloadProvider(): UfoloadProvider {
  const provider = new UfoloadProvider();
  provider.assertEnabled();
  return provider;
}
