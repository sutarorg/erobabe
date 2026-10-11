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
import { assertOwnTransitPath, createTransitDownloadUrl, resolveThumbnailUrl } from "@/lib/video/storage";

/** Groq metadata plus the Uqload hand-off can take a few seconds each. */
export const maxDuration = 60;

/**
 * Publishes a video the browser has already streamed into Supabase Storage.
 *
 * Only the storage path travels through this route, so the request stays a few
 * hundred bytes and never trips Vercel's 4.5 MB function body limit. Uqload
 * pulls the actual bytes itself from a signed download URL, which also keeps
 * this function from buffering a multi-gigabyte file in memory.
 *
 * Legacy clients that posted the raw file as multipart/form-data are rejected
 * with an explicit message instead of the opaque
 * `Unexpected token 'R', "Request En"... is not valid JSON` parse error.
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          error: "Video files can no longer be posted to this route",
          details:
            "Hosting rejects request bodies above 4.5 MB. Ask /api/videos/storage-token for a signed URL, upload the file to it from the browser, then post the returned storagePath here.",
        },
        { status: 415 }
      );
    }

    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const categoryId = String(body.categoryId || "").trim();
    const storagePath = assertOwnTransitPath(user.id, String(body.storagePath || ""));
    const fileName = String(body.fileName || storagePath.split("/").pop() || "uploaded-video").slice(0, 240);
    const fileSize = Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null;
    const thumbnailUrl = resolveThumbnailUrl(service, user.id, body.thumbnailPath ?? null);

    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

    // Local uploads always use Uqload. An operator must explicitly configure
    // its server-only key and policy approval before this route can publish.
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
      storagePath,
    });

    try {
      const downloadUrl = await createTransitDownloadUrl(service, storagePath);
      const result = await provider.uploadByUrl(downloadUrl, { tags: generated.metadata.tags.join(", ") });

      const video = await publishVideo({
        service,
        videoId: generated.video.id,
        userId: user.id,
        providerFileId: result.providerFileId,
        playableUrl: provider.getPlayableUrl(result.providerFileId),
        embedUrl: provider.getEmbedUrl(result.providerFileId),
        thumbnailUrl,
      });
      await completeUploadJob(service, job.id, result.providerFileId);
      await service.from("audit_logs").insert({
        actor_id: user.id,
        action: "video_published_from_upload",
        target_type: "video",
        target_id: generated.video.id,
        level: "info",
        metadata: { provider: "uqload", file_name: fileName, file_size: fileSize, transit_path: storagePath },
      });

      return NextResponse.json({
        videoId: generated.video.id,
        jobId: job.id,
        providerFileId: result.providerFileId,
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
