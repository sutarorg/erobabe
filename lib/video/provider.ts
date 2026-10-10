/**
 * Video hosting provider abstraction
 * Keep provider-specific logic out of React components.
 *
 * Supported providers:
 * - uqload (blocked for adult content per TOS — adapter present but disabled in prod)
 * - bunny, cloudflare, s3, internal (future)
 */

export interface UploadRequest {
  fileName: string;
  fileSize: number;
  title?: string;
  description?: string;
  categoryId?: string;
  tags?: string;
  mimeType?: string;
}

export interface UploadResult {
  providerFileId: string;
  playableUrl?: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  status: "processing" | "completed" | "failed";
  rawResponse?: any;
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
 * Uqload provider
 * Docs: https://uqload.vc/api.html
 * TOS: https://uqload.vc/tos — prohibits pornography, nudity, sexual content.
 * Therefore this provider MUST NOT be enabled for adult content without written approval.
 */
export class UqloadProvider implements VideoProvider {
  name = "uqload";

  isEnabled(): boolean {
    // Check if explicitly allowed via env flag and written approval documented
    const allowed = process.env.UQLOAD_ADULT_CONTENT_APPROVED === "true";
    const keyExists = !!process.env.UQLOAD_API_KEY;
    return allowed && keyExists;
  }

  async getUploadServer(): Promise<string> {
    const apiKey = process.env.UQLOAD_API_KEY;
    if (!apiKey) throw new Error("Missing UQLOAD_API_KEY");

    const res = await fetch(`https://uqload.vc/api/upload/server?key=${apiKey}`);
    const json = await res.json();
    if (json.status !== 200 || !json.result) {
      throw new Error(`Uqload getUploadServer failed: ${JSON.stringify(json)}`);
    }
    return json.result as string; // e.g. https://s1.myvideo.com/upload/01
  }

  async uploadFile(serverUrl: string, file: File | Blob, meta: UploadRequest): Promise<UploadResult> {
    const apiKey = process.env.UQLOAD_API_KEY;
    if (!apiKey) throw new Error("Missing UQLOAD_API_KEY");

    const form = new FormData();
    form.append("key", apiKey);
    form.append("file", file, meta.fileName);
    if (meta.title) form.append("file_title", meta.title);
    if (meta.description) form.append("file_descr", meta.description);
    if (meta.tags) form.append("tags", meta.tags);
    form.append("file_public", "1");
    form.append("file_adult", "1");

    const res = await fetch(serverUrl, {
      method: "POST",
      body: form,
    });

    const json = await res.json().catch(async () => {
      // Uqload sometimes returns HTML redirect if html_redirect=1, but we didn't set it
      const text = await res.text();
      throw new Error(`Uqload upload non-JSON response: ${text.slice(0, 500)}`);
    });

    if (json.status !== 200 || !json.files?.[0]) {
      throw new Error(`Uqload upload failed: ${JSON.stringify(json)}`);
    }

    const uploaded = json.files[0];
    return {
      providerFileId: uploaded.filecode,
      status: "processing",
      rawResponse: json,
    };
  }

  async getFileInfo(fileId: string): Promise<FileInfo> {
    const apiKey = process.env.UQLOAD_API_KEY;
    if (!apiKey) throw new Error("Missing UQLOAD_API_KEY");

    const res = await fetch(`https://uqload.vc/api/file/info?key=${apiKey}&file_code=${fileId}`);
    const json = await res.json();
    if (json.status !== 200 || !json.result?.[0]) {
      throw new Error(`Uqload file info failed: ${JSON.stringify(json)}`);
    }
    const info = json.result[0];
    return {
      fileId: info.file_code,
      title: info.file_title,
      status: info.status,
      canPlay: info.canplay === 1,
      thumbnailUrl: info.player_img,
      durationSeconds: info.file_length ? parseInt(info.file_length) : undefined,
      views: info.file_views ? parseInt(info.file_views) : 0,
    };
  }

  async deleteFile(fileId: string): Promise<boolean> {
    const apiKey = process.env.UQLOAD_API_KEY;
    if (!apiKey) throw new Error("Missing UQLOAD_API_KEY");
    const res = await fetch(`https://uqload.vc/api/file/delete?key=${apiKey}&file_code=${fileId}`);
    const json = await res.json();
    return json.status === 200;
  }

  getEmbedUrl(fileId: string): string {
    // Uqload embed pattern (from docs)
    return `https://uqload.vc/embed-${fileId}.html`;
  }

  getPlayableUrl(fileId: string): string {
    // Direct file URL would be via player; for SEO we use embed
    return `https://uqload.vc/${fileId}.html`;
  }
}

/**
 * Internal provider — stores files locally or in Supabase Storage for development
 * and as fallback when external provider is blocked.
 */
export class InternalProvider implements VideoProvider {
  name = "internal";

  isEnabled(): boolean {
    return true;
  }

  async getUploadServer(): Promise<string> {
    // For internal, upload server is our own API route
    return "/api/videos/upload";
  }

  async uploadFile(_serverUrl: string, _file: File | Blob, meta: UploadRequest): Promise<UploadResult> {
    // This method won't be called directly for internal — handled by API route streaming to Supabase Storage
    // Return placeholder
    throw new Error("Internal provider upload should go through /api/videos/upload route");
  }

  async getFileInfo(fileId: string): Promise<FileInfo> {
    // In internal mode, fileId is our video id, info from DB
    // This is stub; real implementation queries Supabase
    return {
      fileId,
      status: 200,
      canPlay: true,
    };
  }

  async deleteFile(_fileId: string): Promise<boolean> {
    return true;
  }

  getEmbedUrl(fileId: string): string {
    // For internal, embed is our own player page
    return `/video/${fileId}`;
  }

  getPlayableUrl(fileId: string): string {
    return `/video/${fileId}`;
  }
}
