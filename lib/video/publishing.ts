import { randomUUID } from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { fallbackSuggestion, suggestVideoMetadata, type SuggestedMetadata } from "@/lib/gemini/client";
import { StreamtapeError } from "@/lib/video/streamtape-protocol";

export type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Values allowed in `videos.provider` / `upload_jobs.provider` after migration
 * 00000000000007. Legacy values (`ufoload`, `uqload`) remain valid for
 * historical rows; `streamtape` is the active integration.
 */
export const VIDEO_PROVIDER_VALUES = ["streamtape", "ufoload", "uqload", "embed", "internal", "bunny", "cloudflare", "s3"] as const;
export type VideoProviderValue = (typeof VIDEO_PROVIDER_VALUES)[number];

export type GeneratedVideo = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category_id: string | null;
};

export async function requireActiveAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin" || profile.status !== "active") throw new Error("Forbidden — admin only");

  return { user, service: createServiceClient() };
}

export function httpErrorStatus(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message.startsWith("Forbidden")) return 403;
  return 500;
}

/**
 * Maps a thrown error onto the HTTP status our routes answer with.
 *
 * A provider rejection is never reported as *our* auth failure: a 403 from
 * Streamtape means the server's credentials are wrong (502 — an upstream
 * misconfiguration), while 409/413/451/509/503 keep their meaning so the admin
 * UI can tell the difference between "session conflict" and "bandwidth limit".
 */
export function errorStatusFrom(error: unknown): number {
  if (error instanceof StreamtapeError) {
    if (error.status === 0) return 504;
    if (error.status === 401 || error.status === 403 || error.status === 402) return 502;
    if (error.status === 400) return 400;
    if (error.status === 409) return 409;
    return error.status >= 400 && error.status < 600 ? error.status : 502;
  }
  const message = error instanceof Error ? error.message : "";
  return httpErrorStatus(message);
}

/** The message an admin should see, with no secrets and no stack traces. */
export function errorMessageFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function normalizeTag(value: string): string {
  return value
    .replace(/[\r\n,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map(normalizeTag)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

async function getCategory(service: ServiceClient, categoryId: string) {
  const { data: category, error } = await service
    .from("categories")
    .select("id, label")
    .eq("id", categoryId)
    .single();
  if (error || !category) throw new Error("Choose a valid category");
  return category as { id: string; label: string };
}

/** Where the metadata for a generated video came from. */
export type MetadataSource = "ai" | "fallback";

export type GeneratedMetadata = {
  title: string;
  description: string;
  tags: string[];
  /** `fallback` when Gemini could not be used — the admin must review it. */
  source: MetadataSource;
  /** Human-readable reason the AI suggestion was unavailable. */
  warning?: string;
};

/** A metadata payload the admin page prepared while the file was uploading. */
export function isPreparedMetadata(value: unknown): value is GeneratedMetadata {
  if (!value || typeof value !== "object") return false;
  const meta = value as GeneratedMetadata;
  const title = typeof meta.title === "string" ? meta.title.trim() : "";
  const description = typeof meta.description === "string" ? meta.description.trim() : "";
  const tags = Array.isArray(meta.tags) ? meta.tags.filter((tag) => typeof tag === "string" && tag.trim()) : [];
  return (meta.source === "ai" || meta.source === "fallback") && title.length >= 3 && description.length > 0 && tags.length > 0;
}

function sanitizePreparedMetadata(meta: GeneratedMetadata): GeneratedMetadata {
  return {
    title: meta.title.replace(/\s+/g, " ").trim().slice(0, 160),
    description: meta.description.replace(/\s+/g, " ").trim().slice(0, 1000),
    tags: normalizeTags(meta.tags),
    source: meta.source,
    ...(meta.warning ? { warning: String(meta.warning).slice(0, 400) } : {}),
  };
}

function cleanMetadata(raw: SuggestedMetadata): { title: string; description: string; tags: string[] } {
  return {
    title: raw.title?.replace(/\s+/g, " ").trim().slice(0, 160),
    description: raw.description?.replace(/\s+/g, " ").trim().slice(0, 1000),
    tags: normalizeTags(Array.isArray(raw.tags) ? raw.tags : []),
  };
}

/**
 * Asks Gemini for a title, description, and tags.
 *
 * Gemini is an enhancement, not a gate: when it is unavailable, misconfigured,
 * or returns output that cannot be parsed, the upload continues with
 * deterministic metadata built from the file name and category, and the reason
 * is reported back so the admin can review and edit before publishing.
 */
async function generateMetadata(
  sourceName: string,
  categoryLabel: string
): Promise<GeneratedMetadata & { raw: SuggestedMetadata }> {
  try {
    const raw = await suggestVideoMetadata({ fileName: sourceName, category: categoryLabel });
    const cleaned = cleanMetadata(raw);
    if (cleaned.title && cleaned.description && cleaned.tags.length) {
      return { ...cleaned, source: "ai", raw };
    }
    throw new Error("Gemini returned an incomplete title, description, or tag list");
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "Gemini metadata generation failed";
    console.warn(`[video-publishing] AI metadata unavailable for "${sourceName}": ${reason}`);

    const raw = fallbackSuggestion(sourceName, categoryLabel);
    const cleaned = cleanMetadata(raw);
    if (!cleaned.title || !cleaned.description || !cleaned.tags.length) {
      throw new Error("Unable to build video metadata — check the file name and category, then try again.");
    }

    return {
      ...cleaned,
      source: "fallback",
      warning: `AI metadata unavailable (${reason.slice(0, 200)}). File-name metadata was used instead — review the title and description before publishing.`,
      raw,
    };
  }
}

async function attachTags(service: ServiceClient, videoId: string, tags: string[]) {
  const tagRows = tags.map((label) => ({ label, slug: slugify(label) }));
  const slugs = tagRows.map((tag) => tag.slug).filter(Boolean);
  if (!slugs.length) return;

  const { data: existing, error: existingError } = await service.from("tags").select("id, slug").in("slug", slugs);
  if (existingError) throw existingError;
  const existingBySlug = new Map((existing || []).map((tag: any) => [tag.slug, tag.id]));
  const missing = tagRows.filter((tag) => !existingBySlug.has(tag.slug));

  if (missing.length) {
    const { data: inserted, error: insertError } = await service
      .from("tags")
      .upsert(missing, { onConflict: "slug" })
      .select("id, slug");
    if (insertError) throw insertError;
    for (const tag of inserted || []) existingBySlug.set(tag.slug, tag.id);
  }

  const pairs = slugs
    .map((slug) => existingBySlug.get(slug))
    .filter(Boolean)
    .map((tagId) => ({ video_id: videoId, tag_id: tagId }));
  if (!pairs.length) return;

  const { error: linkError } = await service.from("video_tags").upsert(pairs, { onConflict: "video_id,tag_id" });
  if (linkError) throw linkError;
}

/**
 * Creates a private processing record after metadata is ready. It becomes
 * public only after an upload/embed operation succeeds and the admin has
 * clicked Publish in the UI.
 *
 * `prepared` is metadata the admin page already fetched (via the existing
 * suggest route) while the file bytes were in flight. Using it skips a second
 * Gemini call after the file code is known.
 */
export async function createGeneratedVideo({
  service,
  userId,
  sourceName,
  categoryId,
  provider,
  thumbnailUrl,
  prepared,
}: {
  service: ServiceClient;
  userId: string;
  sourceName: string;
  categoryId: string;
  provider: VideoProviderValue;
  thumbnailUrl?: string | null;
  /** Already generated while the bytes were in flight — skips a second Gemini call. */
  prepared?: GeneratedMetadata | null;
}): Promise<{ video: GeneratedVideo; metadata: GeneratedMetadata }> {
  const category = await getCategory(service, categoryId);
  const preparedMetadata = prepared && isPreparedMetadata(prepared) ? sanitizePreparedMetadata(prepared) : null;
  // Sanitizing can strip every tag. Fall back to Gemini rather than publishing an untagged row.
  const metadata =
    preparedMetadata && preparedMetadata.title.length >= 3 && preparedMetadata.description && preparedMetadata.tags.length
      ? preparedMetadata
      : await generateMetadata(sourceName, category.label);
  const slugBase = slugify(metadata.title) || "video";
  const slug = `${slugBase}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;

  const { data: video, error: videoError } = await service
    .from("videos")
    .insert({
      slug,
      title: metadata.title,
      description: metadata.description,
      category_id: category.id,
      thumbnail_url: thumbnailUrl || null,
      provider,
      status: "processing",
      rights_status: "cleared",
      visibility: "private",
      moderation_status: "approved",
      created_by: userId,
      updated_by: userId,
    })
    .select("id, slug, title, description, category_id")
    .single();
  if (videoError || !video) throw videoError || new Error("Unable to create video");

  try {
    await attachTags(service, video.id, metadata.tags);
  } catch (error) {
    await service.from("videos").delete().eq("id", video.id);
    throw error;
  }

  return {
    video: video as GeneratedVideo,
    metadata: { title: metadata.title, description: metadata.description, tags: metadata.tags, source: metadata.source, ...(metadata.warning ? { warning: metadata.warning } : {}) },
  };
}

export async function publishVideo({
  service,
  videoId,
  userId,
  providerFileId,
  playableUrl,
  embedUrl,
  thumbnailUrl,
}: {
  service: ServiceClient;
  videoId: string;
  userId: string;
  providerFileId?: string | null;
  playableUrl?: string | null;
  embedUrl?: string | null;
  thumbnailUrl?: string | null;
}) {
  const update: Record<string, string | null> = {
    status: "published",
    visibility: "public",
    rights_status: "cleared",
    moderation_status: "approved",
    published_at: new Date().toISOString(),
    updated_by: userId,
  };
  if (providerFileId !== undefined) update.provider_file_id = providerFileId;
  if (playableUrl !== undefined) update.playable_url = playableUrl;
  if (embedUrl !== undefined) update.embed_url = embedUrl;
  if (thumbnailUrl !== undefined) update.thumbnail_url = thumbnailUrl;

  const { data: video, error } = await service
    .from("videos")
    .update(update)
    .eq("id", videoId)
    .select("id, slug, title, status, thumbnail_url")
    .single();
  if (error) throw error;
  return video;
}

export async function createUploadJob({
  service,
  videoId,
  userId,
  fileName,
  fileSize,
  provider = "streamtape",
  storagePath,
  providerUploadId,
  providerImportId,
}: {
  service: ServiceClient;
  videoId?: string | null;
  userId: string;
  fileName: string;
  fileSize?: number;
  provider?: VideoProviderValue | string;
  /** Transit object in the private video-incoming bucket, when there is one. */
  storagePath?: string | null;
  /** Direct-upload session id (Streamtape session / legacy UFOLOAD upload_id). */
  providerUploadId?: string | null;
  /** Remote-import task id — deliberately separate from the file id. */
  providerImportId?: string | null;
}) {
  const insert: Record<string, unknown> = {
    video_id: videoId ?? null,
    file_name: fileName,
    file_size: fileSize || null,
    provider,
    status: "uploading",
    progress: 0,
    created_by: userId,
  };
  // These columns are added by migrations 00000000000004 / 00000000000006.
  // Omit them rather than fail the insert on a database that has not been
  // migrated yet.
  if (storagePath) insert.storage_path = storagePath;
  if (providerUploadId) insert.provider_upload_id = providerUploadId;
  if (providerImportId) insert.provider_import_id = providerImportId;

  const { data: job, error } = await service.from("upload_jobs").insert(insert).select().single();
  if (error) throw error;
  return job;
}

/**
 * Finds the direct-upload job a completion request is allowed to finish.
 *
 * The client sends only the session id the server itself minted; this lookup
 * proves the session was created for *this* admin, has not been claimed
 * already, and belongs to the expected provider — so a browser can never
 * complete (or publish) someone else's upload.
 */
export async function findUploadJobForSession(
  service: ServiceClient,
  userId: string,
  uploadId: string,
  expectedProvider: VideoProviderValue | string = "streamtape"
): Promise<{
  id: string;
  video_id: string | null;
  file_name: string;
  file_size: number | null;
  provider: string;
  status?: string;
  created_at?: string;
  provider_import_id?: string | null;
} | null> {
  const normalized = String(uploadId || "").trim();
  if (!normalized) return null;

  const { data, error } = await service
    .from("upload_jobs")
    .select("id, video_id, file_name, file_size, provider, status, created_by, created_at, provider_import_id, provider_upload_id")
    .eq("provider_upload_id", normalized)
    .eq("created_by", userId)
    .single();
  if (error || !data) return null;
  if (data.provider && data.provider !== expectedProvider) return null;
  return {
    id: data.id,
    video_id: data.video_id ?? null,
    file_name: data.file_name,
    file_size: data.file_size ?? null,
    provider: data.provider || expectedProvider,
    status: data.status,
    created_at: data.created_at,
    provider_import_id: data.provider_import_id ?? null,
  };
}

/** Records the provider's own progress/state on the job row. */
export async function updateUploadJob(
  service: ServiceClient,
  jobId: string,
  patch: Record<string, unknown>
): Promise<void> {
  if (!jobId) return;
  const { error } = await service.from("upload_jobs").update(patch).eq("id", jobId);
  if (error) throw error;
}

export async function completeUploadJob(service: ServiceClient, jobId: string, providerFileId: string) {
  const { error } = await service
    .from("upload_jobs")
    .update({ provider_file_id: providerFileId, provider_status: "ready", status: "completed", progress: 100 })
    .eq("id", jobId);
  if (error) throw error;
}

/**
 * Persists the identifiers the video host returned for a finished upload or
 * import *without* making the video public.
 *
 * A file that reached the provider is not playable yet: it has to finish
 * converting. The row therefore stays `processing` / private until
 * {@link markVideoReady} is called with a provider confirmation, so nothing
 * unplayable ever appears on a public page.
 *
 * The stored addresses are stable embed pages. Signed/ticketed playback links
 * (which expire) are never written to the database.
 */
export async function attachProviderFile({
  service,
  videoId,
  userId,
  provider,
  providerFileId,
  providerPublicId,
  embedUrl,
  playableUrl,
  thumbnailUrl,
  durationSeconds,
  progress,
}: {
  service: ServiceClient;
  videoId: string;
  userId: string;
  provider: string;
  providerFileId: string;
  providerPublicId?: string | null;
  embedUrl?: string | null;
  playableUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  progress?: number | null;
}) {
  const update: Record<string, unknown> = {
    provider,
    provider_file_id: providerFileId,
    status: "processing",
    visibility: "private",
    updated_by: userId,
  };
  if (providerPublicId !== undefined) update.provider_public_id = providerPublicId || null;
  if (embedUrl !== undefined) update.embed_url = embedUrl || null;
  if (playableUrl !== undefined) update.playable_url = playableUrl || null;
  if (thumbnailUrl !== undefined && thumbnailUrl) update.thumbnail_url = thumbnailUrl;
  if (durationSeconds !== undefined && durationSeconds) update.duration_seconds = durationSeconds;
  if (progress !== undefined && progress !== null) update.provider_progress = Math.max(0, Math.min(100, Math.round(progress)));

  const { data, error } = await service
    .from("videos")
    .update(update)
    .eq("id", videoId)
    .select("id, slug, title, status, thumbnail_url")
    .single();
  if (error) throw error;
  return data;
}

/** Promotes a private processing row once the provider confirms it is ready. */
export async function markVideoReady({
  service,
  videoId,
  userId,
  embedUrl,
  playableUrl,
  thumbnailUrl,
  durationSeconds,
}: {
  service: ServiceClient;
  videoId: string;
  userId?: string;
  embedUrl?: string | null;
  playableUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
}) {
  const update: Record<string, unknown> = {
    status: "published",
    visibility: "public",
    rights_status: "cleared",
    moderation_status: "approved",
    published_at: new Date().toISOString(),
    provider_progress: 100,
    provider_error: null,
  };
  if (userId) update.updated_by = userId;
  if (embedUrl) update.embed_url = embedUrl;
  if (playableUrl) update.playable_url = playableUrl;
  if (thumbnailUrl) update.thumbnail_url = thumbnailUrl;
  if (durationSeconds) update.duration_seconds = durationSeconds;

  const { data, error } = await service.from("videos").update(update).eq("id", videoId).select("id, slug, title, status").single();
  if (error) throw error;
  return data;
}

/**
 * Records a provider failure: the reason is kept, and the row stays private so
 * a failed encode can never be served as playable content.
 */
export async function markVideoFailed({
  service,
  videoId,
  jobId,
  message,
}: {
  service: ServiceClient;
  videoId: string;
  jobId?: string;
  message: string;
}) {
  const reason = String(message || "Provider processing failed").slice(0, 500);
  if (jobId) {
    await service.from("upload_jobs").update({ status: "failed", error_message: reason }).eq("id", jobId);
  }
  await service
    .from("videos")
    .update({ status: "draft", visibility: "private", provider_error: reason })
    .eq("id", videoId);
}

/** Keeps the provider's live progress visible while a file is still encoding. */
export async function recordProviderProgress(
  service: ServiceClient,
  videoId: string,
  progress: number | null | undefined
): Promise<void> {
  if (progress === null || progress === undefined || !Number.isFinite(Number(progress))) return;
  const value = Math.max(0, Math.min(99, Math.round(Number(progress))));
  await service.from("videos").update({ provider_progress: value }).eq("id", videoId);
}

export async function failUpload({
  service,
  videoId,
  jobId,
  message,
}: {
  service: ServiceClient;
  videoId: string;
  jobId?: string;
  message: string;
}) {
  if (jobId) {
    await service.from("upload_jobs").update({ status: "failed", error_message: message }).eq("id", jobId);
  }
  await service.from("videos").update({ status: "draft", visibility: "private" }).eq("id", videoId);
}

export function assertPublicHttpUrl(value: string, label = "URL"): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid http or https URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  if (url.username || url.password) throw new Error(`${label} cannot include credentials`);

  const host = url.hostname.toLowerCase();
  const blockedHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith("169.254.") ||
    host.startsWith("fc") ||
    host.startsWith("fd");
  if (blockedHost) throw new Error(`${label} must point to a public host`);
  return url.toString();
}

export function sourceNameFromUrl(value: string): string {
  const url = new URL(value);
  const name = decodeURIComponent(url.pathname.split("/").pop() || "remote-video");
  return name.slice(0, 240) || "remote-video";
}

export function extractIframeSource(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/<iframe\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/i);
  const source = (match?.[1] || match?.[2] || match?.[3] || trimmed).replace(/&amp;/g, "&");
  return assertPublicHttpUrl(source, "Embed source");
}
