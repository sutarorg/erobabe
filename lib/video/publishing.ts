import { randomUUID } from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { suggestVideoMetadata, type SuggestedMetadata } from "@/lib/gemini/client";

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

async function generateMetadata(sourceName: string, categoryLabel: string): Promise<{
  title: string;
  description: string;
  tags: string[];
  raw: SuggestedMetadata;
}> {
  const raw = await suggestVideoMetadata({ fileName: sourceName, category: categoryLabel });
  const title = raw.title?.replace(/\s+/g, " ").trim().slice(0, 160);
  const description = raw.description?.replace(/\s+/g, " ").trim().slice(0, 1000);
  const tags = normalizeTags(Array.isArray(raw.tags) ? raw.tags : []);

  if (!title || !description || !tags.length) {
    throw new Error("Gemini did not return complete title, description, and tags. Try again after checking GEMINI_API_KEY.");
  }

  return { title, description, tags, raw };
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
 * Creates a private processing record after Gemini generated its metadata. It
 * becomes public only after an upload/embed operation succeeds and the admin
 * has clicked Publish in the UI.
 */
export async function createGeneratedVideo({
  service,
  userId,
  sourceName,
  categoryId,
  provider,
  thumbnailUrl,
}: {
  service: ServiceClient;
  userId: string;
  sourceName: string;
  categoryId: string;
  provider: "uqload" | "embed";
  thumbnailUrl?: string | null;
}): Promise<{ video: GeneratedVideo; metadata: { title: string; description: string; tags: string[] } }> {
  const category = await getCategory(service, categoryId);
  const metadata = await generateMetadata(sourceName, category.label);
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

  return { video: video as GeneratedVideo, metadata };
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
  provider = "uqload",
  storagePath,
}: {
  service: ServiceClient;
  videoId: string;
  userId: string;
  fileName: string;
  fileSize?: number;
  provider?: string;
  /** Transit object in the private video-incoming bucket, when there is one. */
  storagePath?: string | null;
}) {
  const insert: Record<string, unknown> = {
    video_id: videoId,
    file_name: fileName,
    file_size: fileSize || null,
    provider,
    status: "uploading",
    progress: 0,
    created_by: userId,
  };
  // The column is added by migration 00000000000004. Omit it rather than fail
  // the insert on a database that has not been migrated yet.
  if (storagePath) insert.storage_path = storagePath;

  const { data: job, error } = await service.from("upload_jobs").insert(insert).select().single();
  if (error) throw error;
  return job;
}

export async function completeUploadJob(service: ServiceClient, jobId: string, providerFileId: string) {
  const { error } = await service
    .from("upload_jobs")
    .update({ provider_file_id: providerFileId, status: "processing", progress: 100 })
    .eq("id", jobId);
  if (error) throw error;
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
