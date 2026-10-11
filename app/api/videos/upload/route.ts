import { NextRequest, NextResponse } from "next/server";
import { getVideoProvider } from "@/lib/video/provider";
import {
  completeUploadJob,
  createGeneratedVideo,
  createUploadJob,
  failUpload,
  getOptionalFile,
  httpErrorStatus,
  publishVideo,
  requireActiveAdmin,
  uploadThumbnail,
} from "@/lib/video/publishing";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const UQLOAD_SNAPSHOT_LIMIT = 300 * 1024;

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const formData = await req.formData();
    const file = getOptionalFile(formData, "file");
    const thumbnail = getOptionalFile(formData, "thumbnail");
    const categoryId = String(formData.get("categoryId") || "").trim();

    if (!file) return NextResponse.json({ error: "Select a video file" }, { status: 400 });
    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Video file is too large (max 2 GB)" }, { status: 413 });
    if (!file.type.startsWith("video/")) return NextResponse.json({ error: "Only video files are allowed" }, { status: 400 });

    // Local uploads always use Uqload. An operator must explicitly configure
    // its server-only key and policy approval before this route can publish.
    const provider = getVideoProvider("uqload");
    if (!provider.isEnabled()) {
      return NextResponse.json(
        {
          error: "Uqload upload is not enabled",
          details: "Set UQLOAD_API_KEY and UQLOAD_ADULT_CONTENT_APPROVED=true only after obtaining the provider approval required for this content.",
        },
        { status: 503 }
      );
    }

    const thumbnailUrl = await uploadThumbnail({ service, userId: user.id, file: thumbnail });
    const generated = await createGeneratedVideo({
      service,
      userId: user.id,
      sourceName: file.name,
      categoryId,
      provider: "uqload",
      thumbnailUrl,
    });
    const job = await createUploadJob({
      service,
      videoId: generated.video.id,
      userId: user.id,
      fileName: file.name,
      fileSize: file.size,
    });

    try {
      const server = await provider.getUploadServer();
      const result = await provider.uploadFile(server, file, {
        fileName: file.name,
        fileSize: file.size,
        title: generated.metadata.title,
        description: generated.metadata.description,
        tags: generated.metadata.tags.join(", "),
        mimeType: file.type,
        // Uqload limits custom snapshots to 300 KB. The full thumbnail is
        // still stored in video-thumbnails and used on our site.
        snapshot: thumbnail && thumbnail.size <= UQLOAD_SNAPSHOT_LIMIT ? thumbnail : undefined,
        snapshotFileName: thumbnail?.name,
      });

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
        metadata: { provider: "uqload", file_name: file.name, file_size: file.size },
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
