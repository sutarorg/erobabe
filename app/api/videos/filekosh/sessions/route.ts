import { NextRequest, NextResponse } from "next/server";
import { requireActiveAdmin, getCategory } from "@/lib/video/publishing";
import {
  createdVideo,
  filekoshRequest,
  FileKoshError,
  providerError,
  uploadConfiguration,
} from "@/lib/video/filekosh";
import { sessionInput, validateVideo } from "@/lib/video/filekosh-validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { service, user } = await requireActiveAdmin();
    let policy = null,
      configurationError = null;
    try {
      policy = uploadConfiguration().policy;
    } catch (e) {
      configurationError = providerError(e).error;
    }
    const { data, error } = await service
      .from("filekosh_uploads")
      .select(
        "id, title, original_name, state, video_id, provider_id, thumbnail_path, created_at",
      )
      .eq("created_by", user.id)
      .neq("state", "completed")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return NextResponse.json(
      { policy, configurationError, sessions: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}
export async function POST(req: NextRequest) {
  try {
    const { service, user } = await requireActiveAdmin();
    const { policy } = uploadConfiguration();
    const parsed = sessionInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        {
          error:
            "Invalid video metadata. Title, filename, size, MIME type and category are required.",
        },
        { status: 400 },
      );
    const input = parsed.data;
    const invalid = validateVideo(
      { type: input.mimeType, size: input.sizeBytes },
      policy,
    );
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    await getCategory(service, input.categoryId);
    const { data: existing, error: lookupError } = await service
      .from("filekosh_uploads")
      .select("*")
      .eq("id", input.sessionId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      if (existing.created_by !== user.id)
        throw new FileKoshError("Upload session unavailable.", 403);
      if (
        existing.original_name !== input.originalName ||
        Number(existing.size_bytes) !== input.sizeBytes ||
        existing.mime_type !== input.mimeType
      )
        throw new FileKoshError(
          "The selected file does not match this session.",
          409,
        );
      if (!existing.upload_url)
        throw new FileKoshError(
          "Session creation outcome is uncertain or this upload is already completed. Use recovery below; do not create another session.",
          409,
        );
      return NextResponse.json({
        sessionId: existing.id,
        uploadUrl: existing.upload_url,
        headers: policy.headers,
      });
    }
    const { error: reserveError } = await service
      .from("filekosh_uploads")
      .insert({
        id: input.sessionId,
        created_by: user.id,
        title: input.title,
        original_name: input.originalName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        duration_seconds: input.durationSeconds ?? null,
        category_id: input.categoryId,
      });
    if (reserveError) throw reserveError;
    let remote;
    try {
      remote = createdVideo.parse(
        await filekoshRequest("/videos", "POST", {
          title: input.title,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          ...(input.durationSeconds === undefined
            ? {}
            : { durationSeconds: input.durationSeconds }),
          platform: "WEB",
        }),
      );
    } catch (e) {
      // Only definite rejection can release the reservation. A timeout/5xx may have created a remote video.
      if (e instanceof FileKoshError && e.definitelyRejected) {
        await service
          .from("filekosh_uploads")
          .delete()
          .eq("id", input.sessionId)
          .eq("created_by", user.id);
      }
      throw e;
    }
    const { error } = await service
      .from("filekosh_uploads")
      .update({
        provider_id: remote.id,
        provider_slug: remote.slug,
        upload_url: remote.uploadUrl,
        state: "uploading",
      })
      .eq("id", input.sessionId)
      .eq("created_by", user.id);
    if (error) throw error;
    return NextResponse.json(
      {
        sessionId: input.sessionId,
        uploadUrl: remote.uploadUrl,
        headers: policy.headers,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
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
