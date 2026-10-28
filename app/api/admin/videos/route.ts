import { suggestCarouselCopy } from "@/lib/metadata/openrouter";
import type { CarouselCopyResult } from "@/lib/metadata/openrouter";
import { NextRequest, NextResponse } from "next/server";
import {
  httpErrorStatus,
  requireActiveAdmin,
  type ServiceClient,
} from "@/lib/video/publishing";
import { removeThumbnailObject, resolveImageValue } from "@/lib/video/storage";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Admin video maintenance: publish/unpublish, change/remove a thumbnail, place
 * a video in the homepage carousel, regenerate its carousel copy, or delete a
 * video.
 *
 * Uploads are gone: the catalog is embedded from damplips, so publishing only
 * verifies that the row has a playable destination. Deleting a row never
 * touches the external media; the reference is recorded for operator review.
 *
 * Placing a video in a carousel slot also generates that video's short carousel
 * copy through the AI (max 5 words headline, max 10 words teaser). A failure
 * there never blocks the assignment: the copy degrades to the listing text,
 * trimmed to the same budget, and the response says what happened.
 */

export const CAROUSEL_SLOTS = 3;
/** One POST body / one SQL `IN` list. Large enough for select-all on a typical catalog page. */
const MAX_BULK_DELETE = 500;

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
 * the slot before is moved out first. Passing `null` clears the video's slot —
 * and the short copy that only the carousel card uses.
 */
async function assignCarouselSlot(
  service: ServiceClient,
  id: string,
  position: number | null,
  copy: CarouselCopyResult | null,
): Promise<boolean> {
  if (position !== null) {
    // Whatever held the slot keeps neither the slot nor the short copy that was
    // written for it.
    const { error: clearError } = await service
      .from("videos")
      .update({
        carousel_position: null,
        carousel_title: null,
        carousel_description: null,
      })
      .eq("carousel_position", position)
      .neq("id", id);
    if (clearError && !isMissingColumnError(clearError)) throw clearError;
    if (clearError) {
      const { error: slotOnlyError } = await service
        .from("videos")
        .update({ carousel_position: null })
        .eq("carousel_position", position)
        .neq("id", id);
      if (slotOnlyError) throw slotOnlyError;
    }
  }

  const payload = {
    carousel_position: position,
    carousel_title: position === null ? null : copy?.title || null,
    carousel_description: position === null ? null : copy?.description || null,
  };

  const { error } = await service.from("videos").update(payload).eq("id", id);
  if (!error) return true;

  // Migration 00000000000020 adds the copy columns. Until it is applied the slot
  // itself still works, so degrade instead of failing the assignment.
  if (!isMissingColumnError(error)) throw error;
  const { error: slotError } = await service
    .from("videos")
    .update({ carousel_position: position })
    .eq("id", id);
  if (slotError) throw slotError;
  return false;
}

/** PostgREST reports a column the running schema does not have yet. */
function isMissingColumnError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (!candidate) return false;
  if (candidate.code === "PGRST204") return true;
  return /could not find the '.*' column/i.test(String(candidate.message || ""));
}

async function loadVideo(service: ServiceClient, id: string) {
  const { data, error } = await service
    .from("videos")
    .select("id, slug, title, thumbnail_url, provider, provider_file_id")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Video not found");
  return data as {
    id: string;
    slug: string;
    title: string;
    thumbnail_url: string | null;
    provider: string | null;
    provider_file_id: string | null;
  };
}

/**
 * The extra fields the carousel needs to write a card: the listing the copy is
 * derived from, the slot the video is in, and its category.
 *
 * Kept separate from `loadVideo` so a thumbnail or delete request never depends
 * on the carousel columns or on the category relationship.
 */
async function loadCarouselVideo(service: ServiceClient, id: string) {
  const { data, error } = await service
    .from("videos")
    .select(
      "id, slug, title, description, carousel_position, category:categories(label)",
    )
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Video not found");
  const row = data as {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    carousel_position: number | null;
    category: { label?: string } | { label?: string }[] | null;
  };
  const category = Array.isArray(row.category) ? row.category[0] : row.category;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    carousel_position: row.carousel_position ?? null,
    category_label: category?.label ? String(category.label) : "",
  };
}

/** The AI call that writes the two short lines of a carousel card. */
async function carouselCopyFor(video: {
  title: string;
  description: string | null;
  category_label: string;
}): Promise<CarouselCopyResult> {
  return suggestCarouselCopy({
    title: video.title,
    description: video.description,
    category: video.category_label,
  });
}

const CAROUSEL_COPY_UNSTORED =
  "The carousel copy columns are missing from the database — apply migration 00000000000020_carousel_ai_copy.sql. The slot was still saved.";

/** What the admin UI needs to know about the copy, without the key or prompt. */
function carouselCopyReport(
  copy: CarouselCopyResult | null,
  stored: boolean,
) {
  if (!copy) return null;
  return {
    source: copy.source,
    model: copy.model,
    trimmed: copy.trimmed,
    stored,
    ...(stored
      ? copy.warning
        ? { warning: copy.warning }
        : {}
      : { warning: CAROUSEL_COPY_UNSTORED }),
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
        .select("id, slug, provider, requires_reupload, playable_url, embed_url")
        .eq("id", id)
        .single();
      if (error || !video) return badRequest("Video not found");
      if (video.requires_reupload) return badRequest("Video not eligible");
      if (!video.playable_url && !video.embed_url) {
        return badRequest("This video has no playable media URL");
      }
      const { error: publishError } = await service
        .from("videos")
        .update({
          status: "published",
          visibility: "public",
          rights_status: "cleared",
          moderation_status: "approved",
          requires_reupload: false,
          published_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq("id", id);
      if (publishError) throw publishError;
      await audit(service, user.id, "video_published", id, {
        slug: video.slug,
        provider: video.provider,
      });
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
      const video = await loadCarouselVideo(service, id);
      // The homepage card needs its own two short lines; only a video that is
      // entering the carousel is asked for them.
      const copy = position === null ? null : await carouselCopyFor(video);
      const copyStored = await assignCarouselSlot(service, id, position, copy);
      await audit(
        service,
        user.id,
        position ? "video_carousel_assigned" : "video_carousel_cleared",
        id,
        {
          slug: video.slug,
          slot: position,
          ...(position
            ? {
                carousel_title: copy?.title,
                carousel_description: copy?.description,
                carousel_copy_source: copy?.source,
                ...(copy?.trimmed ? { carousel_copy_trimmed: true } : {}),
              }
            : {}),
        },
      );
      revalidatePublicTag("videos");
      return NextResponse.json({
        video: {
          id,
          carousel_position: position,
          carousel_title: position === null ? null : copy?.title || null,
          carousel_description: position === null ? null : copy?.description || null,
        },
        carouselCopy: position === null ? null : carouselCopyReport(copy, copyStored),
      });
    }

    // Re-run the AI for a video that is already in a carousel slot — useful
    // after the listing was rewritten, or after a fallback copy was stored.
    if (body.action === "regenerate_carousel_copy") {
      const video = await loadCarouselVideo(service, id);
      if (!video.carousel_position)
        return badRequest("Video is not in the homepage carousel");
      const copy = await carouselCopyFor(video);
      const copyStored = await assignCarouselSlot(
        service,
        id,
        video.carousel_position,
        copy,
      );
      await audit(service, user.id, "video_carousel_copy_regenerated", id, {
        slug: video.slug,
        slot: video.carousel_position,
        carousel_title: copy.title,
        carousel_description: copy.description,
        carousel_copy_source: copy.source,
        ...(copy.trimmed ? { carousel_copy_trimmed: true } : {}),
      });
      revalidatePublicTag("videos");
      return NextResponse.json({
        video: {
          id,
          carousel_position: video.carousel_position,
          carousel_title: copy.title,
          carousel_description: copy.description,
        },
        carouselCopy: carouselCopyReport(copy, copyStored),
      });
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
        .select("id, slug, title, thumbnail_url, provider, provider_file_id")
        .in("id", bulkIds);
      if (rowsError) throw rowsError;
      const found = (rows || []) as Array<{
        id: string;
        slug: string;
        title: string;
        thumbnail_url: string | null;
        provider: string | null;
        provider_file_id: string | null;
      }>;

      const foundIds = found.map((row) => row.id);
      const { error: deleteError } = foundIds.length
        ? await service.from("videos").delete().in("id", foundIds)
        : { error: null };
      if (deleteError) throw deleteError;

      await Promise.all([
        ...found.map((row) => removeThumbnailObject(service, row.thumbnail_url)),
        found.length
          ? service.from("audit_logs").insert(
              found.map((row) => ({
                actor_id: user.id,
                action: "video_deleted",
                target_type: "video",
                target_id: row.id,
                level: "info",
                metadata: {
                  slug: row.slug,
                  title: row.title,
                  provider: row.provider,
                  bulk: true,
                },
              })),
            )
          : Promise.resolve(),
      ]);

      revalidatePublicTag("videos");
      return NextResponse.json({
        deleted: foundIds,
        failed: [],
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

    // video_tags / video_events cascade; rights_records are ON DELETE SET NULL
    // — the row is gone without orphaning other tables.
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
