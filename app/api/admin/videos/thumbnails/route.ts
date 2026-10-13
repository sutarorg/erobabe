import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { generateFrameThumbnail } from "@/lib/video/frame-thumbnail";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Generates an automatic frame thumbnail for existing direct-link videos that
 * have none. Admin-only. Videos that already have a thumbnail are left alone,
 * so an admin's own image is never overwritten.
 */

export const maxDuration = 60;

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

    const { data, error } = await service
      .from("videos")
      .select("id, slug, title, thumbnail_url, playable_url, provider")
      .in("id", ids);
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const id of ids) {
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

      try {
        const thumbnailUrl = await generateFrameThumbnail(service, user.id, String(video.playable_url));
        const { error: updateError } = await service.from("videos").update({ thumbnail_url: thumbnailUrl }).eq("id", id);
        if (updateError) throw updateError;
        await service.from("audit_logs").insert({
          actor_id: user.id,
          action: "video_thumbnail_generated",
          target_type: "video",
          target_id: id,
          level: "info",
          metadata: { slug: video.slug, source: "frame" },
        });
        results.push({ id, status: "generated", thumbnailUrl });
      } catch (frameError) {
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
