import { randomUUID } from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { fallbackSuggestion, suggestVideoMetadata, type SuggestedMetadata } from "@/lib/gemini/client";
import { isPublicHostname } from "@/lib/video/url-safety";

export type ServiceClient = ReturnType<typeof createServiceClient>;

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
  // Mistakes in what the admin sent — not server faults.
  if (message.startsWith("Choose a valid category")) return 400;
  if (/^That thumbnail path is not a valid upload/.test(message)) return 400;
  return 500;
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
 * Creates a private `processing` record after metadata is ready. For UFOLOAD
 * uploads and imports it becomes public only when UFOLOAD reports the file
 * `ready` (see `lib/video/processing.ts`); iframe embeds publish immediately
 * because there is nothing to process.
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
  provider: "ufoload" | "embed";
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

/** Facts UFOLOAD reported about a finished file, stored beside the embed URL. */
export type ProviderVideoDetails = {
  durationSeconds?: number | null;
  resolution?: string | null;
  quality?: "HD" | "4K" | null;
};

type PublishArgs = {
  service: ServiceClient;
  videoId: string;
  /** The admin who asked for the video; `null` once that account has been removed. */
  userId: string | null;
  providerFileId?: string | null;
  playableUrl?: string | null;
  embedUrl?: string | null;
  thumbnailUrl?: string | null;
  details?: ProviderVideoDetails;
};

export type PublishedVideo = { id: string; slug: string; title: string; status: string; thumbnail_url: string | null };

/**
 * Makes a video public.
 *
 * With `expectStatus` the call is a compare-and-set: the row is only updated
 * while it still has that status, so two reconcilers racing on the same video
 * (a cron run and an admin poll) publish it once. It then returns `null` when
 * the row was no longer in the expected state. Without it the update is
 * unconditional and a missing row is an error.
 */
export async function publishVideo(args: PublishArgs & { expectStatus: string }): Promise<PublishedVideo | null>;
export async function publishVideo(args: PublishArgs & { expectStatus?: undefined }): Promise<PublishedVideo>;
export async function publishVideo({
  service,
  videoId,
  userId,
  providerFileId,
  playableUrl,
  embedUrl,
  thumbnailUrl,
  expectStatus,
  details,
}: PublishArgs & { expectStatus?: string }): Promise<PublishedVideo | null> {
  const update: Record<string, string | number | null> = {
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
  if (details?.durationSeconds != null) update.duration_seconds = details.durationSeconds;
  if (details?.resolution) update.resolution = details.resolution;
  if (details?.quality) update.quality = details.quality;

  let query = service.from("videos").update(update).eq("id", videoId);
  if (expectStatus) query = query.eq("status", expectStatus);
  const { data: video, error } = await query.select("id, slug, title, status, thumbnail_url").maybeSingle();
  if (error) throw error;
  if (!video && !expectStatus) throw new Error("Unable to publish the video: its record no longer exists");
  return (video as PublishedVideo | null) ?? null;
}

/**
 * Records the work UFOLOAD is doing for one video. A job can exist before its
 * video does (a direct upload has a job from the moment the grant is issued,
 * and a video only once the file has been completed), so `videoId` is optional.
 *
 * The provider identifiers are stored in separate columns on purpose:
 *  - `provider_upload_id`       — a direct-upload session
 *  - `provider_import_task_id`  — a URL-import task
 *  - `provider_file_id`         — the file UFOLOAD actually hosts
 * An import task id must never be written to `provider_file_id`.
 */
export async function createUploadJob({
  service,
  videoId,
  userId,
  fileName,
  fileSize,
  provider = "ufoload",
  status = "uploading",
  storagePath,
  providerUploadId,
  providerImportTaskId,
  providerStatus,
}: {
  service: ServiceClient;
  videoId?: string | null;
  userId: string;
  fileName: string;
  fileSize?: number;
  provider?: string;
  status?: "pending" | "uploading" | "processing";
  /** Transit object in the legacy private video-incoming bucket, when there is one. */
  storagePath?: string | null;
  providerUploadId?: string | null;
  providerImportTaskId?: string | null;
  providerStatus?: string | null;
}) {
  const insert: Record<string, unknown> = {
    video_id: videoId ?? null,
    file_name: fileName,
    file_size: fileSize || null,
    provider,
    status,
    progress: 0,
    created_by: userId,
  };
  // Columns added by migrations 00000000000004 / 00000000000006. They are only
  // sent when set, so a database that has not been migrated yet fails loudly
  // (on the column) only for the flows that really need them.
  if (storagePath) insert.storage_path = storagePath;
  if (providerUploadId) insert.provider_upload_id = providerUploadId;
  if (providerImportTaskId) insert.provider_import_task_id = providerImportTaskId;
  if (providerStatus) insert.provider_status = providerStatus;

  const { data: job, error } = await service.from("upload_jobs").insert(insert).select().single();
  if (error) throw error;
  return job;
}

/**
 * Marks a job as handed to the provider's processing pipeline. This is not
 * "finished": the video stays private until the provider reports `ready`.
 */
export async function completeUploadJob(
  service: ServiceClient,
  jobId: string,
  providerFileId: string,
  extra: { videoId?: string; progress?: number; providerStatus?: string | null } = {}
) {
  const update: Record<string, unknown> = {
    provider_file_id: providerFileId,
    status: "processing",
    progress: extra.progress ?? 0,
    error_message: null,
  };
  if (extra.videoId) update.video_id = extra.videoId;
  if (extra.providerStatus !== undefined) update.provider_status = extra.providerStatus;
  const { error } = await service.from("upload_jobs").update(update).eq("id", jobId);
  if (error) throw error;
}

export async function failUpload({
  service,
  videoId,
  jobId,
  message,
  status = "failed",
}: {
  service: ServiceClient;
  videoId?: string | null;
  jobId?: string;
  message: string;
  status?: "failed" | "cancelled";
}) {
  if (jobId) {
    await service.from("upload_jobs").update({ status, error_message: message }).eq("id", jobId);
  }
  if (videoId) {
    await service.from("videos").update({ status: "draft", visibility: "private" }).eq("id", videoId);
  }
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

  // Literal private / loopback / link-local / metadata addresses (IPv4 in any
  // notation `URL` canonicalises, and IPv6), `localhost`, `.local` and
  // single-label hosts are refused. The download itself happens on UFOLOAD's
  // servers, which apply their own SSRF rules too.
  if (!isPublicHostname(url.hostname)) throw new Error(`${label} must point to a public host`);
  return url.toString();
}

export function sourceNameFromUrl(value: string): string {
  const url = new URL(value);
  let name = url.pathname.split("/").pop() || "remote-video";
  try {
    name = decodeURIComponent(name);
  } catch {
    // A malformed %-escape must not reject an otherwise valid link — keep the raw segment.
  }
  return name.slice(0, 240) || "remote-video";
}

export function extractIframeSource(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/<iframe\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/i);
  const source = (match?.[1] || match?.[2] || match?.[3] || trimmed).replace(/&amp;/g, "&");
  return assertPublicHttpUrl(source, "Embed source");
}
