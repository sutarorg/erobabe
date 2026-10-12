/**
 * Video hosting provider abstraction.
 *
 * Keep provider-specific logic out of React components. `direct_url` is the
 * default: admins paste direct MP4 links and Erobabe stores and plays the
 * URL. No hosting-provider API or relay is needed.
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

export const DEFAULT_VIDEO_PROVIDER = "direct_url";

/**
 * Provider factory.
 *
 * An unknown or missing `VIDEO_PROVIDER` fails closed with an actionable
 * configuration error. It must never silently fall back to a retired provider:
 * a typo in the environment would otherwise send new uploads somewhere nobody
 * is watching. `ufoload` is explicitly retired — legacy rows keep their stored
 * playback/embed URLs and are answered as history by the status route.
 *
 * `direct_url` is the default: admins paste direct MP4 links and Erobabe
 * stores and plays the URL. No hosting-provider API or relay is needed.
 * `streamtape`, `ufoload`, and `uqload` are historical — existing rows keep
 * their stored playback/embed URLs and remain viewable.
 */
export function getVideoProvider(name: string = process.env.VIDEO_PROVIDER || DEFAULT_VIDEO_PROVIDER): VideoProvider {
  switch (String(name || "").trim().toLowerCase()) {
    case "direct_url":
      return new InternalProvider();
    case "streamtape":
      throw new Error(
        'VIDEO_PROVIDER="streamtape" has been retired. New uploads use direct MP4 URLs (VIDEO_PROVIDER=direct_url); existing Streamtape videos keep their stored playback/embed URLs and remain viewable without contacting the old API.'
      );
    case "ufoload":
      throw new Error(
        'VIDEO_PROVIDER="ufoload" has been retired. New uploads use direct MP4 URLs (VIDEO_PROVIDER=direct_url); existing UFOLOAD videos keep their stored playback/embed URLs and remain viewable without contacting the old API.'
      );
    case "internal":
      return new InternalProvider();
    default:
      throw new Error(
        `Unknown VIDEO_PROVIDER "${name}". Set VIDEO_PROVIDER=direct_url (or "internal" for the local, non-video-hosting placeholder). The retired Streamtape/UFOLOAD/Uqload integrations are not valid targets.`
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
