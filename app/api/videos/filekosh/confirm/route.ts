import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveAdmin } from "@/lib/video/publishing";
import { resolveThumbnailUrl } from "@/lib/video/storage";
import {
  confirmationBody,
  filekoshRequest,
  FileKoshError,
  providerError,
  readyVideo,
  uploadConfiguration,
} from "@/lib/video/filekosh";
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
      return NextResponse.json(
        { error: "Invalid confirmation request." },
        { status: 400 },
      );
    const input = parsed.data;
    const { data: session, error } = await service
      .from("filekosh_uploads")
      .select("*")
      .eq("id", input.sessionId)
      .eq("created_by", user.id)
      .single();
    if (error || !session)
      throw new FileKoshError("Upload session not found.", 404);
    if (session.state === "completed")
      return NextResponse.json({
        videoId: session.video_id,
        slug: session.video_slug,
      });
    if (!session.provider_id)
      throw new FileKoshError(
        "The provider creation outcome is unknown. Reconcile this session with FileKosh support before creating another upload.",
        409,
      );
    const thumbnailPath = input.thumbnailPath ?? session.thumbnail_path;
    const thumbnailUrl = resolveThumbnailUrl(service, user.id, thumbnailPath);
    // Save recovery information BEFORE any external confirmation call.
    const { error: saveError } = await service
      .from("filekosh_uploads")
      .update({ thumbnail_path: thumbnailPath, state: "confirming" })
      .eq("id", session.id)
      .neq("state", "completed");
    if (saveError) throw saveError;
    // Readiness is independently verified by GET, not inferred from a 200 or an undocumented results envelope.
    let raw = await filekoshRequest(
      `/videos/${encodeURIComponent(session.provider_id)}`,
    );
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as { status?: string }).status !== "READY"
    ) {
      const { confirmationTemplate } = uploadConfiguration();
      // Confirm retry semantics are undocumented. Atomically permit ONE attempt,
      // then reconcile using safe GETs after lost responses instead of replaying POST.
      const { data: claimed, error: claimError } = await service
        .from("filekosh_uploads")
        .update({ confirmation_attempted: true })
        .eq("id", session.id)
        .eq("confirmation_attempted", false)
        .neq("state", "completed")
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed)
        throw new FileKoshError(
          "Confirmation was already attempted. FileKosh is not READY yet; retry this check later or reconcile the session with provider support.",
          409,
        );
      try {
        await filekoshRequest(
          "/videos/confirm",
          "POST",
          confirmationBody(confirmationTemplate, session.provider_id),
        );
      } catch (e) {
        if (e instanceof FileKoshError && e.definitelyRejected)
          await service
            .from("filekosh_uploads")
            .update({ confirmation_attempted: false })
            .eq("id", session.id);
        throw e;
      }
      raw = await filekoshRequest(
        `/videos/${encodeURIComponent(session.provider_id)}`,
      );
    }
    const remote = readyVideo.parse(raw);
    if (
      remote.id !== session.provider_id ||
      remote.slug !== session.provider_slug ||
      remote.sizeBytes !== Number(session.size_bytes) ||
      remote.mimeType !== session.mime_type
    )
      throw new FileKoshError(
        "FileKosh metadata does not match the reserved upload.",
      );
    const { data, error: persistError } = await service.rpc(
      "finish_filekosh_upload",
      {
        p_session: session.id,
        p_admin: user.id,
        p_embed: remote.embedUrl,
        p_share: remote.url,
        p_thumbnail: thumbnailUrl,
        p_duration: remote.durationSeconds ?? session.duration_seconds,
      },
    );
    if (persistError || !data)
      throw new FileKoshError(
        "FileKosh is READY, but database persistence failed. Retry confirmation for this session; the video will not be uploaded again.",
      );
    revalidatePublicTag("videos");
    return NextResponse.json(data);
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json(
      { error: r.error },
      {
        status: r.status,
        headers: r.retryAfter ? { "Retry-After": String(r.retryAfter) } : {},
      },
    );
  }
}
