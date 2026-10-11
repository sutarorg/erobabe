import { NextRequest, NextResponse } from "next/server";
import { getVideoProvider, UqloadProvider } from "@/lib/video/provider";
import {
  completeUploadJob,
  createGeneratedVideo,
  createUploadJob,
  failUpload,
  httpErrorStatus,
  publishVideo,
  requireActiveAdmin,
} from "@/lib/video/publishing";
import { resolveThumbnailUrl } from "@/lib/video/storage";

/** Gemini metadata plus a Uqload title edit can take a few seconds. */
export const maxDuration = 60;

/**
 * Publishes a video the browser has already uploaded directly to Uqload.
 *
 * The request is JSON only (`providerFileId`, category, optional thumbnail
 * path). Video bytes never pass through this host.
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          error: "Video files can no longer be posted to this route",
          details:
            "Ask /api/videos/uqload-session for an upload server, POST the file directly to Uqload, then send the returned filecode here as providerFileId.",
        },
        { status: 415 }
      );
    }

    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const categoryId = String(body.categoryId || "").trim();
    const providerFileId = String(body.providerFileId || body.filecode || body.file_code || "").trim();
    const fileName = String(body.fileName || "uploaded-video").slice(0, 240);
    const fileSize = Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null;
    const thumbnailUrl = resolveThumbnailUrl(service, user.id, body.thumbnailPath ?? null);

    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });
    if (!providerFileId) {
      return NextResponse.json(
        {
          error: "Uqload file code is required",
          details: "Upload the video directly to Uqload first, then POST the filecode as providerFileId.",
        },
        { status: 400 }
      );
    }

    const provider = getVideoProvider("uqload");
    if (!provider.isEnabled() || !(provider instanceof UqloadProvider)) {
      return NextResponse.json(
        {
          error: "Uqload upload is not enabled",
          details: "Set UQLOAD_API_KEY and UQLOAD_ADULT_CONTENT_APPROVED=true only after obtaining the provider approval required for this content.",
        },
        { status: 503 }
      );
    }

    const generated = await createGeneratedVideo({
      service,
      userId: user.id,
      sourceName: fileName,
      categoryId,
      provider: "uqload",
      thumbnailUrl,
    });
    const job = await createUploadJob({
      service,
      videoId: generated.video.id,
      userId: user.id,
      fileName,
      fileSize: fileSize || undefined,
    });

    try {
      const video = await publishVideo({
        service,
        videoId: generated.video.id,
        userId: user.id,
        providerFileId,
        playableUrl: provider.getPlayableUrl(providerFileId),
        embedUrl: provider.getEmbedUrl(providerFileId),
        thumbnailUrl,
      });
      await completeUploadJob(service, job.id, providerFileId);

      provider
        .editFile(providerFileId, {
          title: generated.metadata.title,
          description: generated.metadata.description,
          tags: generated.metadata.tags.join(", "),
        })
        .catch(() => {});

      await service.from("audit_logs").insert({
        actor_id: user.id,
        action: "video_published_from_upload",
        target_type: "video",
        target_id: generated.video.id,
        level: "info",
        metadata: { provider: "uqload", file_name: fileName, file_size: fileSize, provider_file_id: providerFileId },
      });

      return NextResponse.json({
        videoId: generated.video.id,
        jobId: job.id,
        providerFileId,
        status: video.status,
        video,
        metadata: generated.metadata,
        processing: true,
      });
    } catch (uploadError: any) {
      await failUpload({ service, videoId: generated.video.id, jobId: job.id, message: uploadError.message || "Uqload upload failed" });
      throw uploadError;
    }
  } catch (error: any) {
    const status = httpErrorStatus(error.message || "");
    return NextResponse.json({ error: error.message || "Upload failed" }, { status });
  }
}
