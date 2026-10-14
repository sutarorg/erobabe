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
    const { data: session, error } = await service
      .from("bunny_uploads")
      .select("*")
      .eq("id", parsed.data.sessionId)
      .eq("created_by", user.id)
      .single();
    if (error || !session)
      throw new BunnyError("Upload session not found.", 404);
    if (session.state === "completed")
      return NextResponse.json({
        videoId: session.video_id,
        slug: session.video_slug,
      });
    if (!session.provider_id)
      throw new BunnyError(
        "Creation unknown. Reconcile the session marker in Bunny before another upload.",
        409,
      );
    const thumbnailPath = parsed.data.thumbnailPath ?? session.thumbnail_path;
    let thumbnailUrl: string | null;
    try {
      thumbnailUrl = resolveThumbnailUrl(service, user.id, thumbnailPath);
    } catch {
      throw new BunnyError(
        "Thumbnail path does not belong to this administrator.",
        400,
      );
    }
    if (thumbnailUrl) {
      // Verify the signed upload really wrote an object; a URL alone proves nothing.
      const { data: objects, error: storageError } = await service.storage
        .from(THUMBNAIL_BUCKET)
        .list(user.id, { search: thumbnailPath.split("/")[1], limit: 100 });
      if (
        storageError ||
        !objects?.some(
          (o: { name: string; metadata?: { size?: number } }) =>
            o.name === thumbnailPath.split("/")[1] &&
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
    const failed = remote.status === 5 || remote.status === 6;
    const { error: saveError } = await service
      .from("bunny_uploads")
      .update({
        thumbnail_path: thumbnailPath,
        provider_status: remote.status,
        state: failed ? "failed" : remote.status === 4 ? "ready" : "processing",
        last_error: failed ? `Bunny ${BUNNY_STATUS[remote.status]}` : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id)
      .neq("state", "completed");
    if (saveError) throw saveError;
    if (failed)
      throw new BunnyError(
        `Bunny ${BUNNY_STATUS[remote.status]}: inspect the library dashboard. The video has not been published.`,
        409,
      );
    if (remote.status !== 4)
      return NextResponse.json(
        {
          processing: true,
          providerStatus: BUNNY_STATUS[remote.status],
          progress: remote.encodeProgress,
        },
        {
          status: 202,
          headers: { "Cache-Control": "no-store", "Retry-After": "5" },
        },
      );
    if (!thumbnailUrl)
      throw new BunnyError(
        "Thumbnail generation required. Select the same source file to retry thumbnail generation; video bytes need not upload again.",
        409,
      );
    const { data, error: persistError } = await service.rpc(
      "finish_bunny_upload",
      {
        p_session: session.id,
        p_admin: user.id,
        p_embed: bunnyEmbedUrl(session.library_id, session.provider_id),
        p_thumbnail: thumbnailUrl,
        p_duration: remote.length,
      },
    );
    if (persistError || !data)
      throw new BunnyError(
        "Bunny Finished, but database persistence failed. Retry confirmation without re-uploading video.",
      );
    revalidatePublicTag("videos");
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json(
      { error: r.error },
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
