import { bunnyRequest, bunnyVideoSchema } from "@/lib/video/bunny";
import { NextRequest, NextResponse } from "next/server";
import {
  httpErrorStatus,
  requireActiveAdmin,
  type ServiceClient,
} from "@/lib/video/publishing";
import { removeThumbnailObject, resolveImageValue } from "@/lib/video/storage";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Admin video maintenance: change/remove a thumbnail, or delete a video.
 *
 * Nothing here touches provider video bytes. Deleting removes the catalog row,
 * not remote Bunny Stream media; provider-side retention/cleanup is separate. The thumbnail, which
 * *is* uploaded to Supabase Storage, is removed from the bucket as well (best
 * effort: a missing object never fails the database change).
 */

export const CAROUSEL_SLOTS = 3;
const MAX_BULK_DELETE = 200;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Maps a thrown error onto the HTTP status the admin should see. */
function statusForError(message: string): number {
  if (message === "Video not found") return 404;
  if (/not a valid|Provide |A valid video id|is required/i.test(message))
    return 400;
  return httpErrorStatus(message);
}

async function readBody(
  req: NextRequest,
): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  return body as Record<string, unknown>;
}

/** `1`–`3` or `null` → the slot; anything else → `undefined` (rejected). */
export function parseCarouselPosition(
  value: unknown,
): number | null | undefined {
  if (value === null || value === "" || value === 0 || value === "0")
    return null;
  const numeric = typeof value === "string" ? Number(value.trim()) : value;
  if (
    Number.isInteger(numeric) &&
    (numeric as number) >= 1 &&
    (numeric as number) <= CAROUSEL_SLOTS
  ) {
    return numeric as number;
  }
  return undefined;
}

/**
 * Puts a video into a carousel slot. A slot holds one video, so whatever held
 * the slot before is moved out first. Passing `null` clears the video's slot.
 */
async function assignCarouselSlot(
  service: ServiceClient,
  id: string,
  position: number | null,
) {
  if (position !== null) {
    const { error: clearError } = await service
      .from("videos")
      .update({ carousel_position: null })
      .eq("carousel_position", position)
      .neq("id", id);
    if (clearError) throw clearError;
  }
  const { error } = await service
    .from("videos")
    .update({ carousel_position: position })
    .eq("id", id);
  if (error) throw error;
}

async function loadVideo(service: ServiceClient, id: string) {
  const { data, error } = await service
    .from("videos")
    .select("id, slug, title, thumbnail_url, provider")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Video not found");
  return data as {
    id: string;
    slug: string;
    title: string;
    thumbnail_url: string | null;
    provider: string | null;
  };
}

async function audit(
  service: ServiceClient,
  userId: string,
  action: string,
  videoId: string,
  metadata: Record<string, unknown>,
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
    if (!UUID_PATTERN.test(id))
      return badRequest("A valid video id is required");

    if (body.action === "publish") {
      const { data: video, error } = await service
        .from("videos")
        .select("*")
        .eq("id", id)
        .single();
      if (
        error ||
        !video ||
        video.provider !== "bunny" ||
        video.requires_reupload
      )
        return badRequest("Video not eligible");
      const remote = bunnyVideoSchema.parse(
        await bunnyRequest(
          `/${video.provider_file_id}`,
          "GET",
          undefined,
          video.bunny_library_id,
        ),
      );
      if (
        remote.status !== 4 ||
        remote.guid !== video.provider_file_id ||
        String(remote.videoLibraryId) !== video.bunny_library_id
      )
        return badRequest("Bunny media is not ready");
      const ownership = ["owned", "licensed", "partner"].includes(
        String(body.ownership),
      )
        ? String(body.ownership)
        : "partner";
      const evidence =
        typeof body.evidence === "string" && body.evidence.trim().length >= 20
          ? body.evidence.trim().slice(0, 2000)
          : "Published by active administrator after Bunny encoding completed";
      const { error: publishError } = await service.rpc(
        "publish_reviewed_bunny",
        {
          p_video: id,
          p_admin: user.id,
          p_ownership: ownership,
          p_evidence: evidence,
        },
      );
      if (publishError) throw publishError;
      revalidatePublicTag("videos");
      return NextResponse.json({
        video: { id, status: "published", visibility: "public" },
      });
    }
    if (body.action === "unpublish") {
      const { error } = await service
        .from("videos")
        .update({
          status: "unpublished",
          visibility: "private",
          updated_by: user.id,
        })
        .eq("id", id);
      if (error) throw error;
      await audit(service, user.id, "video_unpublished", id, {});
      revalidatePublicTag("videos");
      return NextResponse.json({
        video: { id, status: "unpublished", visibility: "private" },
      });
    }

    // Homepage carousel slot: 1–3, or null to take the video out of the carousel.
    if ("carousel_position" in body) {
      const position = parseCarouselPosition(body.carousel_position);
      if (position === undefined)
        return badRequest("carousel_position must be 1, 2, 3, or null");
      const video = await loadVideo(service, id);
      await assignCarouselSlot(service, id, position);
      await audit(
        service,
        user.id,
        position ? "video_carousel_assigned" : "video_carousel_cleared",
        id,
        {
          slug: video.slug,
          slot: position,
        },
      );
      revalidatePublicTag("videos");
      return NextResponse.json({ video: { id, carousel_position: position } });
    }

    if (!("thumbnail_url" in body))
      return badRequest(
        "Provide thumbnail_url (a URL, a storage path, or null)",
      );

    const video = await loadVideo(service, id);
    const previous = video.thumbnail_url;

    // `null`/"" removes the thumbnail; anything else is an existing public URL
    // or the storage path of a freshly uploaded file.
    const thumbnailUrl = resolveImageValue(service, body.thumbnail_url);
    const { error } = await service
      .from("videos")
      .update({ thumbnail_url: thumbnailUrl })
      .eq("id", id);
    if (error) throw error;

    const removed = Boolean(previous) && previous !== thumbnailUrl;
    if (removed) await removeThumbnailObject(service, previous);

    await audit(
      service,
      user.id,
      thumbnailUrl ? "video_thumbnail_updated" : "video_thumbnail_removed",
      id,
      {
        slug: video.slug,
        had_thumbnail: Boolean(previous),
        ...(removed ? { removed_previous_object: true } : {}),
      },
    );

    revalidatePublicTag("videos");
    return NextResponse.json({ video: { id, thumbnail_url: thumbnailUrl } });
  } catch (error: any) {
    const message = error?.message || "Unable to update the video";
    return NextResponse.json(
      { error: message },
      { status: statusForError(message) },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();

    // Single: { id } (or ?id=). Bulk: { ids: [...] } from the select-all toolbar.
    const body = await readBody(req);
    const bulkIds = Array.isArray(body?.ids)
      ? body!.ids.map((value) => String(value ?? "").trim())
      : null;
    if (bulkIds) {
      if (!bulkIds.length) return badRequest("Select at least one video");
      if (bulkIds.length > MAX_BULK_DELETE)
        return badRequest(`Delete up to ${MAX_BULK_DELETE} videos at a time`);
      if (!bulkIds.every((value) => UUID_PATTERN.test(value)))
        return badRequest("A valid video id is required");

      const { data: rows, error: rowsError } = await service
        .from("videos")
        .select("id, slug, title, thumbnail_url, provider")
        .in("id", bulkIds);
      if (rowsError) throw rowsError;
      const found = (rows || []) as Array<{
        id: string;
        slug: string;
        title: string;
        thumbnail_url: string | null;
        provider: string | null;
      }>;

      if (found.length) {
        const { error } = await service
          .from("videos")
          .delete()
          .in(
            "id",
            found.map((row) => row.id),
          );
        if (error) throw error;
      }

      for (const row of found) {
        await removeThumbnailObject(service, row.thumbnail_url);
        await audit(service, user.id, "video_deleted", row.id, {
          slug: row.slug,
          title: row.title,
          provider: row.provider,
          had_thumbnail: Boolean(row.thumbnail_url),
          bulk: true,
        });
      }

      revalidatePublicTag("videos");
      return NextResponse.json({
        deleted: found.map((row) => row.id),
        missing: bulkIds.filter(
          (value) => !found.some((row) => row.id === value),
        ),
      });
    }

    const id = String(
      body?.id || new URL(req.url).searchParams.get("id") || "",
    ).trim();
    if (!UUID_PATTERN.test(id))
      return badRequest("A valid video id is required");

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
    return NextResponse.json(
      { error: message },
      { status: statusForError(message) },
    );
  }
}
