import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveAdmin } from "@/lib/video/publishing";
import { resolveThumbnailUrl, THUMBNAIL_BUCKET } from "@/lib/video/storage";
import {
  bunnyRequest,
  bunnyVideoSchema,
  BUNNY_STATUS,
  BunnyError,
  providerError,
} from "@/lib/video/bunny";
import { bunnyEmbedUrl } from "@/lib/video/playback";
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
    const { service, user } = await requireActiveAdmin();
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

    const thumbnailPath = parsed.data.thumbnailPath ?? session.thumbnail_path;
    let thumbnailUrl: string | null;
    try {
      // Session thumbnails belong to the administrator who uploaded the video,
      // even when another active administrator performs the background check.
      thumbnailUrl = resolveThumbnailUrl(
        service,
        session.created_by,
        thumbnailPath,
      );
    } catch {
      throw new BunnyError(
        "Thumbnail path does not belong to this upload session.",
        400,
      );
    }
    if (thumbnailUrl) {
      // Verify the signed upload really wrote an object; a URL alone proves nothing.
      const { data: objects, error: storageError } = await service.storage
        .from(THUMBNAIL_BUCKET)
        .list(session.created_by, {
          search: thumbnailPath!.split("/")[1],
          limit: 100,
        });
      if (
        storageError ||
        !objects?.some(
          (o: { name: string; metadata?: { size?: number } }) =>
            o.name === thumbnailPath!.split("/")[1] &&
            Number(o.metadata?.size) > 0,
        )
      )
        throw new BunnyError(
          "Thumbnail storage failed or object missing. Retry the thumbnail without re-uploading video.",
          409,
        );
    }
    const remote = bunnyVideoSchema.parse(
      await bunnyRequest(
        `/${session.provider_id}`,
        "GET",
        undefined,
        session.library_id,
      ),
    );
    if (
      remote.guid !== session.provider_id ||
      String(remote.videoLibraryId) !== session.library_id
    )
      throw new BunnyError("Bunny returned mismatched video identity.");

    const providerStatus = BUNNY_STATUS[remote.status];
    const embed = bunnyEmbedUrl(session.library_id, session.provider_id);
    if (remote.status === 5 || remote.status === 6) {
      const { data: failureResult, error: failError } = await service.rpc("fail_bunny_upload", {
        p_session: session.id,
        p_admin: user.id,
        p_provider_status: remote.status,
      });
      if (failError) throw failError;
      if (failureResult?.state === "completed") {
        revalidatePublicTag("videos");
        return NextResponse.json(failureResult, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      return NextResponse.json(
        {
          failed: true,
          providerStatus,
          error: `Bunny ${providerStatus}: inspect the library dashboard. The video has not been published.`,
        },
        {
          status: 409,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    if (remote.status !== 4) {
      if (!thumbnailUrl || !thumbnailPath)
        throw new BunnyError(
          "Thumbnail generation required. Select the same source file to retry; video bytes need not upload again.",
          409,
        );
      const { data, error: stageError } = await service.rpc(
        "stage_bunny_upload",
        {
          p_session: session.id,
          p_admin: user.id,
          p_embed: embed,
          p_thumbnail_path: thumbnailPath,
          p_thumbnail: thumbnailUrl,
          p_provider_status: remote.status,
          p_progress: Math.floor(remote.encodeProgress),
        },
      );
      if (stageError || !data)
        throw new BunnyError(
          "Bunny accepted the upload, but the encoding row could not be saved. Retry status confirmation; video bytes will not upload again.",
        );
      if (data.state === "completed") {
        revalidatePublicTag("videos");
        return NextResponse.json(data, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      return NextResponse.json(
        {
          processing: true,
          videoId: data.videoId || session.id,
          slug: data.slug,
          providerStatus,
          progress: Math.min(99, Math.floor(remote.encodeProgress)),
        },
        {
          status: 202,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "15",
          },
        },
      );
    }

    if (!thumbnailUrl || !thumbnailPath)
      throw new BunnyError(
        "Thumbnail generation required. Select the same source file to retry; video bytes need not upload again.",
        409,
      );
    const { error: readyError } = await service
      .from("bunny_uploads")
      .update({
        thumbnail_path: thumbnailPath,
        provider_status: 4,
        state: "ready",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (readyError) throw readyError;
    const { data, error: persistError } = await service.rpc(
      "finish_bunny_upload",
      {
        p_session: session.id,
        p_admin: user.id,
        p_embed: embed,
        p_thumbnail: thumbnailUrl,
        p_duration: remote.length,
      },
    );
    if (persistError || !data)
      throw new BunnyError(
        "Bunny Finished, but database persistence failed. Retry confirmation without re-uploading video.",
      );
    revalidatePublicTag("videos");
    return NextResponse.json(
      { ...data, status: "published", visibility: "public", published: true },
      {
        headers: { "Cache-Control": "no-store" },
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
