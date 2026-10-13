import { NextRequest, NextResponse } from "next/server";
import { httpErrorStatus, requireActiveAdmin, type ServiceClient } from "@/lib/video/publishing";
import { removeThumbnailObject, resolveImageValue } from "@/lib/video/storage";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Admin video maintenance: change/remove a thumbnail, or delete a video.
 *
 * Nothing here touches the video bytes — direct-link videos are played from the
 * original host, so deleting the row only forgets the URL. The thumbnail, which
 * *is* uploaded to Supabase Storage, is removed from the bucket as well (best
 * effort: a missing object never fails the database change).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Maps a thrown error onto the HTTP status the admin should see. */
function statusForError(message: string): number {
  if (message === "Video not found") return 404;
  if (/not a valid|Provide |A valid video id|is required/i.test(message)) return 400;
  return httpErrorStatus(message);
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  return body as Record<string, unknown>;
}

async function loadVideo(service: ServiceClient, id: string) {
  const { data, error } = await service
    .from("videos")
    .select("id, slug, title, thumbnail_url, provider")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Video not found");
  return data as { id: string; slug: string; title: string; thumbnail_url: string | null; provider: string | null };
}

async function audit(
  service: ServiceClient,
  userId: string,
  action: string,
  videoId: string,
  metadata: Record<string, unknown>
) {
  await service.from("audit_logs").insert({
    actor_id: userId,
    action,
    target_type: "video",
    target_id: videoId,
    level: "info",
    metadata,
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const body = await readBody(req);
    if (!body) return badRequest("Invalid request");

    const id = String(body.id || "").trim();
    if (!UUID_PATTERN.test(id)) return badRequest("A valid video id is required");
    if (!("thumbnail_url" in body)) return badRequest("Provide thumbnail_url (a URL, a storage path, or null)");

    const video = await loadVideo(service, id);
    const previous = video.thumbnail_url;

    // `null`/"" removes the thumbnail; anything else is an existing public URL
    // or the storage path of a freshly uploaded file.
    const thumbnailUrl = resolveImageValue(service, body.thumbnail_url);
    const { error } = await service.from("videos").update({ thumbnail_url: thumbnailUrl }).eq("id", id);
    if (error) throw error;

    const removed = Boolean(previous) && previous !== thumbnailUrl;
    if (removed) await removeThumbnailObject(service, previous);

    await audit(service, user.id, thumbnailUrl ? "video_thumbnail_updated" : "video_thumbnail_removed", id, {
      slug: video.slug,
      had_thumbnail: Boolean(previous),
      ...(removed ? { removed_previous_object: true } : {}),
    });

    revalidatePublicTag("videos");
    return NextResponse.json({ video: { id, thumbnail_url: thumbnailUrl } });
  } catch (error: any) {
    const message = error?.message || "Unable to update the video";
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();

    // The id may arrive in the body (fetch DELETE with JSON) or as ?id=.
    const body = await readBody(req);
    const id = String(body?.id || new URL(req.url).searchParams.get("id") || "").trim();
    if (!UUID_PATTERN.test(id)) return badRequest("A valid video id is required");

    const video = await loadVideo(service, id);

    const { error } = await service.from("videos").delete().eq("id", id);
    if (error) throw error;

    // video_tags / video_events cascade; upload_jobs and rights_records are
    // ON DELETE SET NULL — the row is gone without orphaning other tables.
    await removeThumbnailObject(service, video.thumbnail_url);
    await audit(service, user.id, "video_deleted", id, {
      slug: video.slug,
      title: video.title,
      provider: video.provider,
      had_thumbnail: Boolean(video.thumbnail_url),
    });

    revalidatePublicTag("videos");
    return NextResponse.json({ deleted: true, id });
  } catch (error: any) {
    const message = error?.message || "Unable to delete the video";
    return NextResponse.json({ error: message }, { status: statusForError(message) });
  }
}
