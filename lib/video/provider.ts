/**
 * Video hosting provider abstraction.
 * Keep provider-specific logic out of React components. The Uqload API key is
 * only ever returned to an authenticated admin as a short-lived upload-session
 * field so the browser can POST the video bytes straight to Uqload.
 */

import { parseUqloadUploadResponse } from "@/lib/video/uqload-response";
import {
  expectedTitlesFor,
  pickConfirmedUpload,
  type ConfirmedUpload,
  type LibraryFile,
} from "@/lib/video/uqload-match";

export { parseUqloadUploadResponse } from "@/lib/video/uqload-response";

export interface DirectUploadSession {
  serverUrl: string;
  fields: Record<string, string>;
}

export interface UploadRequest {
  fileName: string;
  fileSize: number;
  title?: string;
  description?: string;
  categoryId?: string;
  tags?: string;
  mimeType?: string;
  snapshot?: Blob;
  snapshotFileName?: string;
}

export interface UploadResult {
  providerFileId: string;
  playableUrl?: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  status: "processing" | "completed" | "failed";
  rawResponse?: unknown;
}

export interface FileInfo {
  fileId: string;
  title?: string;
  status: number;
  canPlay: boolean;
  thumbnailUrl?: string;
  durationSeconds?: number;
  fileSize?: number;
  views?: number;
}

export interface VideoProvider {
  name: string;
  isEnabled(): boolean;
  getUploadServer(): Promise<string>;
  uploadFile(serverUrl: string, file: File | Blob, meta: UploadRequest): Promise<UploadResult>;
  getFileInfo(fileId: string): Promise<FileInfo>;
  deleteFile(fileId: string): Promise<boolean>;
  getEmbedUrl(fileId: string): string;
  getPlayableUrl(fileId: string): string;
}

function isProviderSuccess(status: unknown): boolean {
  return status === 200 || status === "200";
}

async function readJson(response: Response, operation: string): Promise<any> {
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${operation} returned an invalid response`);
  }
  if (!response.ok) {
    throw new Error(`${operation} failed (${response.status})${json?.msg ? `: ${json.msg}` : ""}`);
  }
  return json;
}

// Factory
export function getVideoProvider(name: string = process.env.VIDEO_PROVIDER || "uqload"): VideoProvider {
  switch (name) {
    case "uqload":
      return new UqloadProvider();
    case "internal":
      return new InternalProvider();
    default:
      return new UqloadProvider();
  }
}

/**
 * Uqload server-side provider.
 *
 * The approval flag is intentionally retained: Uqload's content policy must
 * explicitly permit the platform's intended lawful adult-content use before
 * an operator enables uploads. The key and all provider requests stay on the
 * server.
 */
export class UqloadProvider implements VideoProvider {
  name = "uqload";

  isEnabled(): boolean {
    return process.env.UQLOAD_ADULT_CONTENT_APPROVED === "true" && Boolean(process.env.UQLOAD_API_KEY);
  }

  private getApiKey(): string {
    const apiKey = process.env.UQLOAD_API_KEY;
    if (!apiKey) throw new Error("Missing UQLOAD_API_KEY");
    return apiKey;
  }

  private apiUrl(path: string, parameters: Record<string, string | number | undefined> = {}) {
    const url = new URL(`https://uqload.vc/api/${path}`);
    url.searchParams.set("key", this.getApiKey());
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    return url;
  }

  async getUploadServer(): Promise<string> {
    const response = await fetch(this.apiUrl("upload/server"), { cache: "no-store" });
    const json = await readJson(response, "Uqload upload-server request");
    // Uqload occasionally answers with a mirror list ("https://s1…,https://s2…"
    // or an array) — take the first usable URL instead of failing the upload.
    const raw = json?.result;
    const candidates = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
      .map((value: unknown) => String(value).trim())
      .filter((value: string) => /^https?:\/\//i.test(value));
    if (!isProviderSuccess(json.status) || !candidates.length) {
      throw new Error(`Uqload could not provide an upload server${json?.msg ? `: ${json.msg}` : ""}`);
    }
    return candidates[0];
  }

  /**
   * Server URL + form fields for a browser POST straight to Uqload.
   * The `key` field is Uqload's documented API-key parameter; it is only
   * returned to authenticated admins via `/api/videos/uqload-session`.
   */
  async getDirectUploadSession(): Promise<DirectUploadSession> {
    const serverUrl = await this.getUploadServer();
    return {
      serverUrl,
      fields: {
        key: this.getApiKey(),
        file_public: "1",
        file_adult: "1",
      },
    };
  }

  /**
   * Confirms a file that the browser just POSTed straight to Uqload.
   *
   * The browser can never read the upload server's JSON response (no CORS
   * headers), so the file code has to be recovered from the account library via
   * the documented `file/list` endpoint.
   *
   * Identification is a **diff** against a pre-upload snapshot of the account's
   * file codes, never the title alone: Uqload ignores multipart fields sent
   * after the `file` part, so it stores a title derived from the file name
   * (`my trip.mp4` → `My_Trip`) and a cleaned title can never match it. The
   * title is only a ranking hint (see `lib/video/uqload-match.ts`).
   */
  async findRecentUpload(
    meta: { title?: string; fileName?: string },
    options: { knownFileCodes?: string[] | null; finalAttempt?: boolean } = {}
  ): Promise<ConfirmedUpload | null> {
    const files = await this.listRecentUploads();
    return pickConfirmedUpload({
      files,
      // `undefined` (no snapshot passed) behaves like an unreadable snapshot:
      // never fall back to "the newest new file" on a guess alone.
      knownFileCodes: options.knownFileCodes ?? null,
      expectedTitles: expectedTitlesFor(meta),
      finalAttempt: options.finalAttempt,
    });
  }

  /**
   * The newest files in the account library, mapped to a stable shape.
   * `file/list` is metered by Uqload, so callers poll sparingly — one request
   * per poll — and reuse the same query for the pre-upload snapshot so the
   * diff stays consistent.
   */
  async listRecentUploads(perPage = 50): Promise<LibraryFile[]> {
    const files = await this.listLibraryFiles({ per_page: perPage });
    return files
      .filter((file) => typeof file?.file_code === "string" && file.file_code.trim() !== "")
      .map((file) => ({
        fileCode: String(file.file_code),
        title: typeof file.title === "string" ? file.title : "",
        uploaded: typeof file.uploaded === "string" ? file.uploaded : undefined,
        canPlay: file.canplay === 1 || file.canplay === "1" || file.canplay === true,
      }));
  }

  private async listLibraryFiles(parameters: Record<string, string | number> = {}): Promise<any[]> {
    const response = await fetch(this.apiUrl("file/list", { per_page: 50, ...parameters }), { cache: "no-store" });
    const json = await readJson(response, "Uqload file-list request");
    return Array.isArray(json?.result?.files) ? json.result.files : [];
  }

  async uploadFile(serverUrl: string, file: File | Blob, meta: UploadRequest): Promise<UploadResult> {
    const form = new FormData();
    // ⚠️ Order matters: Uqload ignores every multipart field that arrives
    // *after* the `file` part (verified against the live API — a `file_title`
    // sent behind the file is dropped and the title falls back to the file
    // name). Every scalar must therefore precede the file; Uqload's own curl
    // sample puts the optional `snapshot` last.
    form.append("key", this.getApiKey());
    if (meta.title) form.append("file_title", meta.title);
    if (meta.description) form.append("file_descr", meta.description);
    if (meta.tags) form.append("tags", meta.tags);
    form.append("file_public", "1");
    form.append("file_adult", "1");
    form.append("file", file, meta.fileName);
    if (meta.snapshot) form.append("snapshot", meta.snapshot, meta.snapshotFileName || "thumbnail.jpg");

    const response = await fetch(serverUrl, { method: "POST", body: form, cache: "no-store" });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Uqload file upload failed (${response.status})`);
    }
    const uploaded = parseUqloadUploadResponse(text);

    return {
      providerFileId: uploaded.filecode,
      status: "processing",
      rawResponse: uploaded,
    };
  }

  async editFile(
    fileId: string,
    meta: { title?: string; description?: string; tags?: string } = {}
  ): Promise<boolean> {
    const response = await fetch(
      this.apiUrl("file/edit", {
        file_code: fileId,
        file_title: meta.title,
        file_descr: meta.description,
        tags: meta.tags,
        file_public: 1,
        file_adult: 1,
      }),
      { cache: "no-store" }
    );
    const json = await readJson(response, "Uqload file edit");
    return isProviderSuccess(json.status);
  }

  /** Queue a remote video URL with Uqload's documented /upload/url endpoint. */
  async uploadByUrl(remoteUrl: string, meta: Pick<UploadRequest, "tags"> = {}): Promise<UploadResult> {
    const response = await fetch(
      this.apiUrl("upload/url", {
        url: remoteUrl,
        file_public: 1,
        file_adult: 1,
        tags: meta.tags,
      }),
      { cache: "no-store" }
    );
    const json = await readJson(response, "Uqload URL upload");
    const fileCode = json?.result?.filecode || json?.result?.file_code;
    if (!isProviderSuccess(json.status) || typeof fileCode !== "string") {
      throw new Error(`Uqload URL upload failed${json?.msg ? `: ${json.msg}` : ""}`);
    }

    return { providerFileId: fileCode, status: "processing", rawResponse: json };
  }

  async getFileInfo(fileId: string): Promise<FileInfo> {
    const response = await fetch(this.apiUrl("file/info", { file_code: fileId }), { cache: "no-store" });
    const json = await readJson(response, "Uqload file-info request");
    const info = json?.result?.[0];
    if (!isProviderSuccess(json.status) || !info) {
      throw new Error(`Uqload file-info request failed${json?.msg ? `: ${json.msg}` : ""}`);
    }
    return {
      fileId: String(info.file_code || fileId),
      title: typeof info.file_title === "string" ? info.file_title : undefined,
      status: Number(info.status || 0),
      canPlay: info.canplay === 1 || info.canplay === "1" || info.canplay === true,
      thumbnailUrl: typeof info.player_img === "string" ? info.player_img : undefined,
      durationSeconds: info.file_length ? Number.parseInt(String(info.file_length), 10) : undefined,
      views: info.file_views ? Number.parseInt(String(info.file_views), 10) : 0,
    };
  }

  async deleteFile(fileId: string): Promise<boolean> {
    const response = await fetch(this.apiUrl("file/delete", { file_code: fileId }), { cache: "no-store" });
    const json = await readJson(response, "Uqload file deletion");
    return isProviderSuccess(json.status);
  }

  getEmbedUrl(fileId: string): string {
    return `https://uqload.vc/embed-${encodeURIComponent(fileId)}.html`;
  }

  getPlayableUrl(fileId: string): string {
    return `https://uqload.vc/${encodeURIComponent(fileId)}.html`;
  }
}

/** Internal provider remains available for local development only. */
export class InternalProvider implements VideoProvider {
  name = "internal";

  isEnabled(): boolean {
    return true;
  }

  async getUploadServer(): Promise<string> {
    return "/api/videos/upload";
  }

  async uploadFile(_serverUrl: string, _file: File | Blob, _meta: UploadRequest): Promise<UploadResult> {
    throw new Error("Internal provider upload should go through /api/videos/upload route");
  }

  async getFileInfo(fileId: string): Promise<FileInfo> {
    return { fileId, status: 200, canPlay: true };
  }

  async deleteFile(_fileId: string): Promise<boolean> {
    return true;
  }

  getEmbedUrl(fileId: string): string {
    return `/video/${fileId}`;
  }

  getPlayableUrl(fileId: string): string {
    return `/video/${fileId}`;
  }
}
