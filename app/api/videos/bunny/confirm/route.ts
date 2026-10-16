import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveAdmin } from "@/lib/video/publishing";
import { reconcileBunnySession } from "@/lib/video/auto-publish";
import { BunnyError, providerError } from "@/lib/video/bunny";
import { revalidatePublicTag } from "@/lib/public/revalidate";
const inputSchema = z
  .object({
    sessionId: z.string().uuid(),
    thumbnailPath: z.string().max(300).nullable().optional(),
  })
  .strict();
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try {
    const { service } = await requireActiveAdmin();
    const parsed = inputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      throw new BunnyError("Invalid confirmation request.", 400);
    // Any active admin can reconcile an encoding row from the shared catalog.
    // The original creator remains the owner recorded on all persisted rows.
    const { data: session, error } = await service
      .from("bunny_uploads")
      .select("*")
      .eq("id", parsed.data.sessionId)
      .single();
    if (error || !session)
      throw new BunnyError("Upload session not found.", 404);
    if (session.state === "completed") {
      // Deleting the catalog video nulls video_id; a deleted video is never
      // reported as published, and confirming never resurrects it. Selecting
      // the file again in Admin → Upload starts a new session for it.
      if (!session.video_id)
        throw Object.assign(
          new BunnyError(
            "This file's video was deleted from the video library, so there is nothing left to confirm. Retry to upload the file again as a new video.",
            409,
          ),
          // Lets the uploader re-arm the queue entry instead of matching prose.
          { code: "video_deleted" },
        );
      return NextResponse.json(
        {
          videoId: session.video_id,
          slug: session.video_slug,
          status: "published",
          visibility: "public",
          published: true,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (session.state === "cancelled")
      throw new BunnyError("This upload session was cancelled.", 409);
    if (!session.provider_id)
      throw new BunnyError(
        "Creation unknown. Reconcile the session marker in Bunny before another upload.",
        409,
      );

    // The same transition the background publisher runs, so a video that
    // finishes encoding while this tab is closed is published by the scheduled
    // sweep instead of waiting for a browser that never comes back.
    const outcome = await reconcileBunnySession(service, session, {
      thumbnailPath: parsed.data.thumbnailPath ?? null,
    });
    if (outcome.state === "published") {
      revalidatePublicTag("videos");
      return NextResponse.json(
        { ...outcome, status: "published", visibility: "public", published: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (outcome.state === "failed")
      return NextResponse.json(
        {
          failed: true,
          providerStatus: outcome.providerStatus,
          error: outcome.error,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        processing: true,
        videoId: session.id,
        slug: outcome.slug,
        providerStatus: outcome.providerStatus,
        progress: outcome.progress,
      },
      {
        status: 202,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "15",
        },
      },
    );
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json(
      { error: r.error, ...(r.code ? { code: r.code } : {}) },
      {
        status: r.status,
        headers: {
          "Cache-Control": "no-store",
          ...(r.retryAfter ? { "Retry-After": String(r.retryAfter) } : {}),
        },
      },
    );
  }
}