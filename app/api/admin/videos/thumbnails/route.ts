import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { generateFrameThumbnail } from "@/lib/video/frame-thumbnail";
import { removeThumbnailObject } from "@/lib/video/storage";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Generates an automatic frame thumbnail for existing direct-link videos that
 * have none. Admin-only. Videos that already have a thumbnail are left alone,
 * so an admin's own image is never overwritten.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_REQUEST = 10;

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.map((value) => String(value ?? "").trim()) : [];
    if (!ids.length) return NextResponse.json({ error: "Select at least one video" }, { status: 400 });
    if (ids.length > MAX_PER_REQUEST) {
      return NextResponse.json({ error: `Generate thumbnails for up to ${MAX_PER_REQUEST} videos at a time` }, { status: 400 });
    }
    if (!ids.every((value) => UUID_PATTERN.test(value))) {
      return NextResponse.json({ error: "A valid video id is required" }, { status: 400 });
    }

    const uniqueIds = [...new Set(ids)];
    const { data, error } = await service
      .from("videos")
      .select("id, slug, title, thumbnail_url, playable_url, provider")
      .in("id", uniqueIds);
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const id of uniqueIds) {
      const video = ((data || []) as any[]).find((row) => String(row.id) === id);
      if (!video) {
        results.push({ id, status: "failed", error: "Video not found" });
        continue;
      }
      if (video.thumbnail_url) {
        results.push({ id, status: "skipped", error: "Already has a thumbnail" });
        continue;
      }
      if (!video.playable_url) {
        results.push({ id, status: "skipped", error: "Only direct-link videos can supply a frame" });
        continue;
      }

      let thumbnailUrl: string | null = null;
      try {
        thumbnailUrl = await generateFrameThumbnail(service, user.id, String(video.playable_url));
        // A manual upload may finish while ffmpeg runs. Never overwrite it.
        const { data: updated, error: updateError } = await service.from("videos")
          .update({ thumbnail_url: thumbnailUrl })
          .eq("id", id)
          .is("thumbnail_url", null)
          .select("id")
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) {
          await removeThumbnailObject(service, thumbnailUrl);
          results.push({ id, status: "skipped", error: "Video was removed or a thumbnail was added while generation was running" });
          continue;
        }
        // A logging outage must not undo a thumbnail already saved to the row.
        try {
          const { error: auditError } = await service.from("audit_logs").insert({
            actor_id: user.id,
            action: "video_thumbnail_generated",
            target_type: "video",
            target_id: id,
            level: "info",
            metadata: { slug: video.slug, source: "frame" },
          });
          if (auditError) console.warn(`[video-thumbnails] Thumbnail saved, but audit logging failed for ${id}`);
        } catch {
          console.warn(`[video-thumbnails] Thumbnail saved, but audit logging failed for ${id}`);
        }
        results.push({ id, status: "generated", thumbnailUrl });
      } catch (frameError) {
        if (thumbnailUrl) await removeThumbnailObject(service, thumbnailUrl);
        results.push({ id, status: "failed", error: errorMessageFrom(frameError, "Frame capture failed") });
      }
    }

    revalidatePublicTag("videos");
    const generated = results.filter((result) => result.status === "generated").length;
    return NextResponse.json({ results, generated });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Thumbnail generation failed") },
      { status: httpErrorStatus(error instanceof Error ? error.message : "") }
    );
  }
}
