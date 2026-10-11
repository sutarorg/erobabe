import { randomUUID } from "crypto";
import type { ServiceClient } from "@/lib/video/publishing";

/**
 * Thumbnail storage only.
 *
 * Video bytes never land in Supabase. Creating a `video-incoming` bucket with
 * a 2 GB file-size cap was throwing
 * `Unable to prepare storage bucket "video-incoming": The object exceeded the
 * maximum allowed size` on projects whose global limit is 50 MB. Videos now
 * POST straight to Uqload from the browser (`/api/videos/uqload-session`).
 *
 * Thumbnails stay here — they are small enough for a signed upload URL.
 */

export const VIDEO_INCOMING_BUCKET = "video-incoming";
export const THUMBNAIL_BUCKET = "video-thumbnails";

export const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
export const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024; // 10 MB
export const THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Long enough for Uqload's remote importer to fetch a queued file. */
export const TRANSIT_DOWNLOAD_TTL_SECONDS = 6 * 60 * 60;

const SAFE_EXTENSION = /^[a-z0-9]{1,10}$/;
const FALLBACK_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "mkv", "avi", "wmv", "flv", "ts", "mpg", "mpeg", "3gp"]);

export function safeFileExtension(fileName: string, mimeType: string, allowed: Set<string>, fallback: string): string {
  const fromName = fileName.split(".").pop()?.toLowerCase() || "";
  if (fromName !== fileName.toLowerCase() && SAFE_EXTENSION.test(fromName) && allowed.has(fromName)) return fromName;

  const fromMime = mimeType.split("/")[1]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  if (fromMime && allowed.has(fromMime)) return fromMime;
  return fallback;
}

export function videoExtension(fileName: string, mimeType: string): string {
  return safeFileExtension(fileName, mimeType, FALLBACK_VIDEO_EXTENSIONS, "mp4");
}

export function thumbnailExtension(fileName: string, mimeType: string): string {
  const extension = safeFileExtension(fileName, mimeType, new Set(["jpg", "jpeg", "png", "gif", "webp"]), "jpg");
  return extension === "jpeg" ? "jpg" : extension;
}

let bucketsChecked = false;

/**
 * Creates the buckets the transit flow needs. Idempotent — the error thrown for
 * an existing bucket is swallowed so a missing migration never blocks uploads.
 */
export async function ensureStorageBuckets(service: ServiceClient): Promise<void> {
  if (bucketsChecked) return;

  const specs: Array<{ id: string; public: boolean; allowedMimeTypes: string[] | null; fileSizeLimit: number }> = [
    { id: THUMBNAIL_BUCKET, public: true, allowedMimeTypes: [...THUMBNAIL_TYPES], fileSizeLimit: MAX_THUMBNAIL_SIZE },
  ];

  let existingIds: Set<string> | null = null;
  try {
    const { data } = await service.storage.listBuckets();
    existingIds = new Set((data || []).map((bucket: { id?: string; name?: string }) => bucket.id || bucket.name || ""));
  } catch {
    existingIds = null;
  }

  for (const spec of specs) {
    if (existingIds?.has(spec.id)) continue;
    const { error } = await service.storage.createBucket(spec.id, {
      public: spec.public,
      fileSizeLimit: spec.fileSizeLimit,
      allowedMimeTypes: spec.allowedMimeTypes,
    });
    // "already exists" / duplicate / a too-large limit on an existing project
    // must never block a thumbnail upload.
    if (error && !/already exists|duplicate|23505|exceeded the maximum allowed size/i.test(String(error.message))) {
      throw new Error(`Unable to prepare storage bucket "${spec.id}": ${error.message}`);
    }
  }

  bucketsChecked = true;
}

/** Resets the memo — used by tests. */
export function resetStorageBucketCache(): void {
  bucketsChecked = false;
}

export function transitPrefix(userId: string): string {
  return `incoming/${userId}`;
}

/**
 * Rejects anything that is not `<userId>/<uuid>.<ext>` inside the transit
 * prefix. Admins must not be able to point a publish request at another
 * account's object or escape the bucket with `..`.
 */
export function assertOwnTransitPath(userId: string, path: string): string {
  const normalized = String(path || "").trim().replace(/^\/+/, "");
  const prefix = `${transitPrefix(userId)}/`;
  const valid =
    normalized.startsWith(prefix) &&
    !normalized.includes("..") &&
    /^[a-zA-Z0-9/_-]+\.[a-z0-9]{1,10}$/.test(normalized) &&
    normalized.slice(prefix.length).split("/").length === 1;
  if (!valid) throw new Error("That storage path is not a valid upload for this account");
  return normalized;
}

export interface UploadTarget {
  uploadUrl: string;
  storagePath: string;
  bucket: string;
  /** Only present for thumbnails, which live in the public bucket. */
  publicUrl?: string;
}

export async function createVideoUploadTarget(_args: {
  service: ServiceClient;
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}): Promise<UploadTarget> {
  throw new Error("Video files upload directly to Uqload. Request /api/videos/uqload-session instead of a storage URL.");
}

export async function createThumbnailUploadTarget({
  service,
  userId,
  fileName,
  fileSize,
  mimeType,
}: {
  service: ServiceClient;
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}): Promise<UploadTarget> {
  if (!(fileSize > 0)) throw new Error("Select a thumbnail image");
  if (fileSize > MAX_THUMBNAIL_SIZE) throw new Error("Thumbnail must be 10 MB or smaller");
  if (!THUMBNAIL_TYPES.has(mimeType)) throw new Error("Thumbnail must be a JPG, PNG, GIF, or WebP image");

  await ensureStorageBuckets(service);
  const storagePath = `${userId}/${randomUUID()}.${thumbnailExtension(fileName, mimeType)}`;
  const bucket = service.storage.from(THUMBNAIL_BUCKET);
  const { data, error } = await bucket.createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data?.signedUrl) throw new Error(`Could not create a thumbnail upload URL: ${error?.message || "unknown storage error"}`);

  const { data: publicData } = bucket.getPublicUrl(storagePath);
  return { uploadUrl: data.signedUrl, storagePath, bucket: THUMBNAIL_BUCKET, publicUrl: publicData?.publicUrl };
}

/** A temporary, publicly fetchable URL for a file already sitting in the transit bucket. */
export async function createTransitDownloadUrl(service: ServiceClient, storagePath: string, expiresIn = TRANSIT_DOWNLOAD_TTL_SECONDS): Promise<string> {
  const { data, error } = await service.storage.from(VIDEO_INCOMING_BUCKET).createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) throw new Error(`Could not create a download URL: ${error?.message || "unknown storage error"}`);
  return data.signedUrl;
}

/** Confirms a thumbnail path belongs to this admin and returns its public URL. */
export function resolveThumbnailUrl(service: ServiceClient, userId: string, storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  const normalized = String(storagePath).trim().replace(/^\/+/, "");
  const valid =
    normalized.startsWith(`${userId}/`) &&
    !normalized.includes("..") &&
    normalized.split("/").length === 2 &&
    /\.(jpe?g|png|gif|webp)$/i.test(normalized);
  if (!valid) throw new Error("That thumbnail path is not a valid upload for this account");

  const { data } = service.storage.from(THUMBNAIL_BUCKET).getPublicUrl(normalized);
  if (!data?.publicUrl) throw new Error("Thumbnail upload did not return a public URL");
  return data.publicUrl;
}

export async function removeTransitObject(service: ServiceClient, storagePath: string): Promise<void> {
  if (!storagePath) return;
  try {
    await service.storage.from(VIDEO_INCOMING_BUCKET).remove([storagePath]);
  } catch {
    // Cleanup is best effort; a stale transit file is not a correctness problem.
  }
}

/** Deletes this admin's transit files older than `maxAgeMs` — best effort. */
export async function cleanupTransitObjects(service: ServiceClient, userId: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  try {
    const prefix = transitPrefix(userId);
    const { data, error } = await service.storage.from(VIDEO_INCOMING_BUCKET).list(prefix, { limit: 200 });
    if (error || !data?.length) return 0;

    const cutoff = Date.now() - maxAgeMs;
    const stale = data
      .filter((entry: any) => {
        const created = Date.parse(entry.created_at || entry.updated_at || "");
        return Number.isFinite(created) && created < cutoff;
      })
      .map((entry: any) => `${prefix}/${entry.name}`.replace(/\/{2,}/g, "/"));
    if (!stale.length) return 0;

    await service.storage.from(VIDEO_INCOMING_BUCKET).remove(stale);
    return stale.length;
  } catch {
    return 0;
  }
}
