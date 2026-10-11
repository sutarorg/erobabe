import { NextRequest, NextResponse } from "next/server";
import {
  createGeneratedVideo,
  extractIframeSource,
  failUpload,
  getOptionalFile,
  httpErrorStatus,
  publishVideo,
  requireActiveAdmin,
  sourceNameFromUrl,
  uploadThumbnail,
} from "@/lib/video/publishing";

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const formData = await req.formData();
    const embedInput = String(formData.get("embed") || "").slice(0, 10_000);
    const categoryId = String(formData.get("categoryId") || "").trim();
    const thumbnail = getOptionalFile(formData, "thumbnail");
    if (!embedInput) return NextResponse.json({ error: "Paste an iframe URL or iframe embed code" }, { status: 400 });
    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

    const embedUrl = extractIframeSource(embedInput);
    const thumbnailUrl = await uploadThumbnail({ service, userId: user.id, file: thumbnail });
    const generated = await createGeneratedVideo({
      service,
      userId: user.id,
      sourceName: sourceNameFromUrl(embedUrl),
      categoryId,
      provider: "embed",
      thumbnailUrl,
    });

    try {
      const video = await publishVideo({
        service,
        videoId: generated.video.id,
        userId: user.id,
        playableUrl: null,
        embedUrl,
        thumbnailUrl,
      });
      await service.from("audit_logs").insert({
        actor_id: user.id,
        action: "video_published_from_embed",
        target_type: "video",
        target_id: generated.video.id,
        level: "info",
        metadata: { provider: "embed", host: new URL(embedUrl).hostname },
      });

      return NextResponse.json({
        videoId: generated.video.id,
        status: video.status,
        video,
        metadata: generated.metadata,
      });
    } catch (publishError: any) {
      await failUpload({ service, videoId: generated.video.id, message: publishError.message || "Unable to publish embed" });
      throw publishError;
    }
  } catch (error: any) {
    const status = httpErrorStatus(error.message || "");
    return NextResponse.json({ error: error.message || "Unable to publish embed" }, { status });
  }
}
