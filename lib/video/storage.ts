import { randomUUID } from "node:crypto";

import type { ServiceClient } from "@/lib/video/publishing";

/**
 * Image storage for the admin-managed artwork (category cards and legacy
 * posters). Video bytes never pass through this app any more: the catalog is
 * embedded from damplips, so there is no upload target to issue.
 */

export const THUMBNAIL_BUCKET = "video-thumbnails";

export const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024; // 10 MB
export const THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const SAFE_EXTENSION = /^[a-z0-9]{1,10}$/;

export function safeFileExtension(fileName: string, mimeType: string, allowed: Set<string>, fallback: string): string {
  const fromName = fileName.split(".").pop()?.toLowerCase() || "";
  if (fromName !== fileName.toLowerCase() && SAFE_EXTENSION.test(fromName) && allowed.has(fromName)) return fromName;

  const fromMime = mimeType.split("/")[1]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  if (fromMime && allowed.has(fromMime)) return fromMime;
  return fallback;
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

export interface UploadTarget {
  uploadUrl: string;
  storagePath: string;
  bucket: string;
  /** Only present for thumbnails, which live in the public bucket. */
  publicUrl?: string;
}

/**
 * Issues a signed upload URL for an artwork image.
 *
 * This is the only upload target the app still issues: category cards and video
 * posters. Video bytes are never uploaded here — the catalog is embedded from
 * damplips — so the route that calls this rejects anything but an image.
 */
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

/** Confirms an upload path belongs to this admin and returns its public URL. */
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

/**
 * Resolves a stored image path to its public URL without requiring the object
 * to belong to the *current* admin.
 *
 * Category thumbnails are edited by whichever admin is on duty, so the owner
 * check used for a fresh upload (`resolveThumbnailUrl`) is too strict here.
 * The path still has to look exactly like an object this app writes —
 * `<owner>/<uuid>.<ext>`, no traversal, no nesting — which keeps a crafted
 * request from pointing a card at an arbitrary object.
 */
export function resolveStoredImageUrl(service: ServiceClient, storagePath: string): string | null {
  const normalized = String(storagePath || "").trim().replace(/^\/+/, "");
  if (!normalized) return null;

  const valid =
    !normalized.includes("..") &&
    normalized.split("/").length === 2 &&
    /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+\.(jpe?g|png|gif|webp)$/i.test(normalized);
  if (!valid) throw new Error("That image path is not a valid stored thumbnail");

  const { data } = service.storage.from(THUMBNAIL_BUCKET).getPublicUrl(normalized);
  if (!data?.publicUrl) throw new Error("Thumbnail did not resolve to a public URL");
  return data.publicUrl;
}

/**
 * Accepts either an absolute public URL (already stored) or a storage path and
 * returns the URL to persist. Anything else is rejected so a typo cannot wipe a
 * working thumbnail silently.
 */
export function resolveImageValue(service: ServiceClient, value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return resolveStoredImageUrl(service, raw);
}

/**
 * Deletes a thumbnail object this app owns. Best effort: a missing object or a
 * storage hiccup must never block the database change that references it.
 */
export async function removeThumbnailObject(service: ServiceClient, publicUrlOrPath: string | null | undefined): Promise<void> {
  const value = String(publicUrlOrPath || "").trim();
  if (!value) return;

  const marker = `/object/public/${THUMBNAIL_BUCKET}/`;
  const markerIndex = value.indexOf(marker);

  let path: string;
  if (markerIndex !== -1) {
    // Supabase public URL: everything after the bucket marker is the object key.
    path = value.slice(markerIndex + marker.length).split("?")[0];
  } else if (/^https?:\/\//i.test(value)) {
    // A public URL on another host (a different project, a proxy, a CDN): keep
    // the trailing `<owner>/<file>` pair, which is the only shape this app writes.
    const segments = new URL(value).pathname.split("/").filter(Boolean);
    path = segments.slice(-2).join("/");
  } else {
    path = value;
  }

  if (!path || path.includes("..") || !/\.[a-z0-9]{2,5}$/i.test(path)) return;

  try {
    await service.storage.from(THUMBNAIL_BUCKET).remove([decodeURIComponent(path)]);
  } catch {
    // Cleanup is best effort — the row no longer references the object.
  }
}
