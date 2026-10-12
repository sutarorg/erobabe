/**
 * Video hosting provider abstraction.
 *
 * Keep provider-specific logic out of React components. UFOLOAD is the active
 * provider; the API key never leaves the server (see `lib/video/ufoload.ts`).
 */

import { UfoloadProvider } from "@/lib/video/ufoload";

export { UfoloadProvider, requireUfoloadProvider, ufoloadApprovalFlag, ufoloadApiKey } from "@/lib/video/ufoload";

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
  rawResponse?: unknown;
}

export interface FileInfo {
  fileId: string;
  title?: string;
  /**
   * Provider-agnostic readiness code: `200` playable, `202` still processing,
   * `500` failed. Kept numeric for compatibility with existing callers.
   */
  status: number;
  canPlay: boolean;
  thumbnailUrl?: string;
  durationSeconds?: number;
  fileSize?: number;
  views?: number;
  /** Raw provider status, e.g. `queued` / `processing` / `ready` / `failed`. */
  providerStatus?: string;
  progress?: number;
  errorMessage?: string;
  /** Short public identifier when the provider exposes one. */
  publicId?: string;
}

export interface VideoProvider {
  name: string;
  isEnabled(): boolean;
  getFileInfo(fileId: string): Promise<FileInfo>;
  deleteFile(fileId: string): Promise<boolean>;
  getEmbedUrl(fileId: string): string;
  getPlayableUrl(fileId: string): string;
}

export const DEFAULT_VIDEO_PROVIDER = "ufoload";

/**
 * Provider factory.
 *
 * An unknown or missing `VIDEO_PROVIDER` fails closed with an actionable
 * configuration error. It must never silently fall back to a retired provider:
 * a typo in the environment would otherwise send new uploads somewhere nobody
 * is watching.
 */
export function getVideoProvider(name: string = process.env.VIDEO_PROVIDER || DEFAULT_VIDEO_PROVIDER): VideoProvider {
  switch (String(name || "").trim().toLowerCase()) {
    case "ufoload":
      return new UfoloadProvider();
    case "internal":
      return new InternalProvider();
    default:
      throw new Error(
        `Unknown VIDEO_PROVIDER "${name}". Set VIDEO_PROVIDER=ufoload (or "internal" for the local, non-video-hosting placeholder). Uqload support has been removed.`
      );
  }
}

/**
 * Internal provider: no video hosting at all.
 *
 * It exists for local UI work and for embed-only deployments; it cannot accept
 * uploads, which is why it is not a valid target for the upload routes.
 */
export class InternalProvider implements VideoProvider {
  name = "internal";

  isEnabled(): boolean {
    return true;
  }

  async getFileInfo(fileId: string): Promise<FileInfo> {
    return { fileId, status: 200, canPlay: true, providerStatus: "ready" };
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
