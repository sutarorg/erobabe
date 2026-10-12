/**
 * Upload limits shared by the browser, the API routes and the provider client.
 *
 * Kept free of Node-only imports on purpose: the admin upload page (a client
 * component) imports this file, so it must never pull in `crypto`, Supabase's
 * server client or anything else that only exists on the server. Keeping the
 * numbers in one module is what keeps the frontend, backend and provider
 * checks consistent.
 */

/** Application-level ceiling for one video file. */
export const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

/** Thumbnails travel through a Supabase signed upload URL, never through UFOLOAD. */
export const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * UFOLOAD accepts chunks of at most 256 MiB on a direct upload (OpenAPI
 * `POST /api/v1/files/uploads`: "chunk_size … не больше 256 МиБ"). The grant's
 * own `chunk_size` can only be smaller.
 */
export const UFOLOAD_MAX_CHUNK_BYTES = 256 * 1024 * 1024;

/**
 * UFOLOAD allows at most 10 active URL imports per account
 * (`POST /api/v1/files/import`: "up to 10 active imports").
 */
export const UFOLOAD_MAX_ACTIVE_IMPORTS = 10;

/**
 * UFOLOAD frees a direct-upload slot after 15 minutes without a call to
 * `GET /api/v1/files/uploads/{id}` and asks long transfers to call it at
 * least every 10 minutes. The browser asks our server to do that (the API key
 * never leaves the server) a little more often than required.
 */
export const UFOLOAD_KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;

/** Videos the admin page accepts, by extension, when the browser reports no MIME type. */
export const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "mkv", "avi", "wmv", "flv", "ts", "mpg", "mpeg", "3gp"] as const;

const VIDEO_EXTENSION_PATTERN = new RegExp(`\\.(${VIDEO_EXTENSIONS.join("|")})$`, "i");

/** True when a name/MIME pair looks like a video file the pipeline can accept. */
export function looksLikeVideo(fileName: string, mimeType?: string | null): boolean {
  if (typeof mimeType === "string" && mimeType.toLowerCase().startsWith("video/")) return true;
  return VIDEO_EXTENSION_PATTERN.test(String(fileName || ""));
}

/** `1.50 GB`, `640 MB`, `12 KB` — for messages. */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "unknown size";
  if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size > 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
