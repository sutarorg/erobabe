import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, errorStatusFrom, httpErrorStatus, isPreparedMetadata, requireActiveAdmin } from "@/lib/video/publishing";
import { completeUfoloadUpload } from "@/lib/video/ufoload-flow";
import { UfoloadProvider } from "@/lib/video/ufoload";
import { resolveThumbnailUrl } from "@/lib/video/storage";

/** Metadata generation plus the provider's completion handshake. */
export const maxDuration = 60;

/**
 * Finishes a UFOLOAD direct upload and attaches it to a video.
 *
 * The request is JSON and carries only the *session* id the server itself
 * handed out earlier (`/api/videos/ufoload-session`). The provider file id is
 * read back from UFOLOAD during completion, so a browser can neither invent one
 * nor complete another admin's upload.
 *
 * The video is created private and stays private until UFOLOAD reports the file
 * as `ready`; the admin UI polls `/api/videos/status` until that happens.
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          error: "Video files must not be posted to this route",
          details:
            "Ask /api/videos/ufoload-session for an upload session, PUT the file's chunks to the returned upload URL, then send the uploadId here.",
        },
        { status: 415 }
      );
    }

    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    if (body.providerFileId || body.filecode || body.file_code) {
      return NextResponse.json(
        {
          error: "Provider file ids are not accepted from the browser",
          details:
            "Complete the upload with the uploadId returned by /api/videos/ufoload-session — the file id is read back from UFOLOAD server-side.",
        },
        { status: 400 }
      );
    }

    const uploadId = String(body.uploadId || "").trim();
    if (!uploadId) {
      return NextResponse.json(
        {
          error: "uploadId is required",
          details: "Start the upload at /api/videos/ufoload-session before completing it here.",
        },
        { status: 400 }
      );
    }

    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

    const fileName = String(body.fileName || "").replace(/\s+/g, " ").trim().slice(0, 240) || "uploaded-video";
    const fileSize = Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null;

    let thumbnailUrl: string | null = null;
    try {
      // Only a thumbnail this admin uploaded through the signed-upload route
      // resolves; anything else is a bad request, not a server failure.
      thumbnailUrl = resolveThumbnailUrl(service, user.id, body.thumbnailPath ?? null);
    } catch (error) {
      return NextResponse.json(
        { error: errorMessageFrom(error, "Invalid thumbnail upload") },
        { status: 400 }
      );
    }

    const provider = new UfoloadProvider();
    provider.assertEnabled();

    const result = await completeUfoloadUpload({
      service,
      userId: user.id,
      provider,
      uploadId,
      categoryId,
      fileName,
      fileSize,
      thumbnailUrl,
      prepared: isPreparedMetadata(body.metadata) ? body.metadata : null,
    });

    await service.from("audit_logs").insert({
      actor_id: user.id,
      action: "video_published_from_upload",
      target_type: "video",
      target_id: result.video.id,
      level: "info",
      metadata: {
        provider: "ufoload",
        file_name: fileName,
        file_size: fileSize,
        provider_file_id: result.providerFileId,
        provider_status: result.providerStatus,
        metadata_source: result.metadata.source,
      },
    });

    return NextResponse.json({
      videoId: result.video.id,
      jobId: result.jobId,
      providerFileId: result.providerFileId,
      providerPublicId: result.providerPublicId,
      providerStatus: result.providerStatus,
      embedUrl: result.embedUrl,
      playableUrl: result.playableUrl,
      status: result.readiness,
      video: result.video,
      metadata: result.metadata,
      metadataSource: result.metadata.source,
      ...(result.metadata.warning ? { metadataWarning: result.metadata.warning } : {}),
      // `processing` is expected: UFOLOAD still has to encode the file.
      processing: result.readiness !== "ready",
      progress: result.progress,
      ...(result.error ? { providerError: result.error } : {}),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Upload failed"), ...(error?.code ? { code: error.code } : {}) },
      { status: errorStatusFrom(error) || httpErrorStatus(error?.message || "") }
    );
  }
}
