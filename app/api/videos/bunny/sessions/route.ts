import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveAdmin, getCategory } from "@/lib/video/publishing";
import {
  bunnyConfiguration,
  bunnyRequest,
  bunnyVideoSchema,
  createdVideoSchema,
  BunnyError,
  providerError,
  signUpload,
  uploadConfiguration,
} from "@/lib/video/bunny";
import { sessionInput, validateVideo } from "@/lib/video/bunny-validation";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(req?: NextRequest) {
  try {
    const { service, user } = await requireActiveAdmin();
    const requestedId = req?.nextUrl.searchParams.get("sessionId");
    if (requestedId) {
      if (!z.string().uuid().safeParse(requestedId).success)
        throw new BunnyError("Invalid recovery session identifier.", 400);
      const { data: session, error } = await service
        .from("bunny_uploads")
        .select(
          "id,title,original_name,mime_type,size_bytes,category_id,state,video_id,video_slug,provider_id,thumbnail_path,created_at,last_error,provider_status",
        )
        .eq("id", requestedId)
        .eq("created_by", user.id)
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ session }, { headers });
    }
    let policy = null,
      configurationError = null;
    try {
      policy = uploadConfiguration().policy;
    } catch (e) {
      configurationError = providerError(e).error;
    }
    const { data, error } = await service
      .from("bunny_uploads")
      .select(
        "id,title,original_name,mime_type,size_bytes,category_id,state,video_id,provider_id,thumbnail_path,created_at,last_error,provider_status",
      )
      .eq("created_by", user.id)
      .neq("state", "completed")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json(
      { policy, configurationError, sessions: data },
      { headers },
    );
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json({ error: r.error }, { status: r.status, headers });
  }
}
export async function POST(req: NextRequest) {
  try {
    const { service, user } = await requireActiveAdmin();
    const { policy } = uploadConfiguration();
    const parsed = sessionInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      throw new BunnyError(
        "Invalid title, filename, category, MIME, file size or session identifier.",
        400,
      );
    const input = parsed.data;
    const invalid = validateVideo(
      { type: input.mimeType, size: input.sizeBytes },
      policy,
    );
    if (invalid) throw new BunnyError(invalid, 400);
    try {
      await getCategory(service, input.categoryId);
    } catch {
      throw new BunnyError("Choose a valid category.", 400);
    }
    const { data: existing, error: lookupError } = await service
      .from("bunny_uploads")
      .select("*")
      .eq("id", input.sessionId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      if (existing.created_by !== user.id)
        throw new BunnyError("Upload session unavailable.", 403);
      if (
        existing.original_name !== input.originalName ||
        Number(existing.size_bytes) !== input.sizeBytes ||
        existing.mime_type !== input.mimeType ||
        existing.title !== input.title ||
        existing.category_id !== input.categoryId
      )
        throw new BunnyError(
          "Selected file or metadata does not match the reserved session.",
          409,
        );
      if (existing.state === "completed")
        return NextResponse.json(
          { completed: true, slug: existing.video_slug },
          { headers },
        );
      if (!existing.provider_id)
        throw new BunnyError(
          "Creation outcome unknown. Reconcile the session marker in the Bunny dashboard before retrying; do not create another video.",
          409,
        );
      const remote = bunnyVideoSchema.parse(
        await bunnyRequest(
          `/${existing.provider_id}`,
          "GET",
          undefined,
          existing.library_id,
        ),
      );
      if (
        remote.guid !== existing.provider_id ||
        String(remote.videoLibraryId) !== existing.library_id
      )
        throw new BunnyError("Provider session identity mismatch.");
      if (remote.status === 5 || remote.status === 6)
        throw new BunnyError(
          "Bunny processing/upload failed. Inspect the provider dashboard before retrying this source.",
          409,
        );
      return NextResponse.json(
        {
          ...signUpload(existing.provider_id, existing.library_id),
          transferred: remote.status !== 0,
          sessionId: existing.id,
        },
        { headers },
      );
    }
    const { libraryId } = bunnyConfiguration();
    const { error: reserveError } = await service.from("bunny_uploads").insert({
      id: input.sessionId,
      created_by: user.id,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      original_name: input.originalName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      duration_seconds: input.durationSeconds ?? null,
      category_id: input.categoryId,
      library_id: libraryId,
    });
    if (reserveError)
      throw new BunnyError(
        "Session already reserved or database unavailable. Retry the same session.",
        409,
      );
    let remote;
    try {
      // A unique title marker permits manual reconciliation after a lost create response.
      remote = createdVideoSchema.parse(
        await bunnyRequest("", "POST", {
          title: `${input.title} [session:${input.sessionId}]`,
        }),
      );
    } catch (e) {
      if (e instanceof BunnyError && e.definitelyRejected)
        await service
          .from("bunny_uploads")
          .delete()
          .eq("id", input.sessionId)
          .eq("created_by", user.id);
      throw e;
    }
    const { error } = await service
      .from("bunny_uploads")
      .update({ provider_id: remote.guid, state: "uploading" })
      .eq("id", input.sessionId)
      .eq("created_by", user.id);
    if (error) throw error;
    return NextResponse.json(
      { ...signUpload(remote.guid), sessionId: input.sessionId },
      { status: 201, headers },
    );
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json(
      { error: r.error },
      {
        status: r.status,
        headers: {
          ...headers,
          ...(r.retryAfter ? { "Retry-After": String(r.retryAfter) } : {}),
        },
      },
    );
  }
}

/** Browser lifecycle reports are diagnostic only, never proof of provider readiness. */
export async function PATCH(req: NextRequest) {
  try {
    const { service, user } = await requireActiveAdmin();
    const parsed = z
      .object({
        sessionId: z.string().uuid(),
        reason: z.enum(["upload_failed", "thumbnail_failed", "user_cancelled"]),
      })
      .strict()
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      throw new BunnyError("Invalid upload lifecycle report.", 400);
    const messages = {
      upload_failed:
        "Browser reported upload or persistence failure. Retry the existing session.",
      thumbnail_failed:
        "Thumbnail generation/storage failed. Retry thumbnail without transferring video again.",
      user_cancelled:
        "Administrator paused the transfer. Reselect the same file to resume.",
    };
    const { data, error } = await service
      .from("bunny_uploads")
      .update({
        state: parsed.data.reason === "user_cancelled" ? "cancelled" : "failed",
        last_error: messages[parsed.data.reason],
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.sessionId)
      .eq("created_by", user.id)
      .neq("state", "completed")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new BunnyError("Incomplete upload session not found.", 404);
    return NextResponse.json({ recorded: true }, { headers });
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json({ error: r.error }, { status: r.status, headers });
  }
}
