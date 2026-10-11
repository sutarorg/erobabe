import { NextRequest, NextResponse } from "next/server";
import { UqloadProvider } from "@/lib/video/provider";
import {
  assertPublicHttpUrl,
  completeUploadJob,
  createGeneratedVideo,
  createUploadJob,
  failUpload,
  getOptionalFile,
  httpErrorStatus,
  publishVideo,
  requireActiveAdmin,
  sourceNameFromUrl,
  uploadThumbnail,
} from "@/lib/video/publishing";

const MAX_URLS_PER_REQUEST = 20;

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const formData = await req.formData();
    const rawUrls = String(formData.get("urls") || "");
    const categoryId = String(formData.get("categoryId") || "").trim();
    const thumbnail = getOptionalFile(formData, "thumbnail");
    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

    const urls = Array.from(
      new Set(
        rawUrls
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => assertPublicHttpUrl(value, "Remote video URL"))
      )
    );
    if (!urls.length) return NextResponse.json({ error: "Enter at least one remote video URL" }, { status: 400 });
    if (urls.length > MAX_URLS_PER_REQUEST) {
      return NextResponse.json({ error: `Upload up to ${MAX_URLS_PER_REQUEST} remote URLs at a time` }, { status: 400 });
    }

    const provider = new UqloadProvider();
    if (!provider.isEnabled()) {
      return NextResponse.json(
        {
          error: "Uqload upload is not enabled",
          details: "Set UQLOAD_API_KEY and UQLOAD_ADULT_CONTENT_APPROVED=true only after obtaining the provider approval required for this content.",
        },
        { status: 503 }
      );
    }

    // One optional thumbnail can be applied to all URLs in this batch.
    const thumbnailUrl = await uploadThumbnail({ service, userId: user.id, file: thumbnail });
    const results: Array<Record<string, unknown>> = [];

    for (const remoteUrl of urls) {
      let generated: Awaited<ReturnType<typeof createGeneratedVideo>> | null = null;
      let job: any = null;
      try {
        generated = await createGeneratedVideo({
          service,
          userId: user.id,
          sourceName: sourceNameFromUrl(remoteUrl),
          categoryId,
          provider: "uqload",
          thumbnailUrl,
        });
        job = await createUploadJob({
          service,
          videoId: generated.video.id,
          userId: user.id,
          fileName: sourceNameFromUrl(remoteUrl),
          provider: "uqload",
        });

        const result = await provider.uploadByUrl(remoteUrl, { tags: generated.metadata.tags.join(", ") });
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
          action: "video_published_from_remote_url",
          target_type: "video",
          target_id: generated.video.id,
          level: "info",
          metadata: { provider: "uqload", host: new URL(remoteUrl).hostname },
        });

        results.push({
          remoteUrl,
          videoId: generated.video.id,
          jobId: job.id,
          providerFileId: result.providerFileId,
          title: video.title,
          status: "published",
          processing: true,
        });
      } catch (error: any) {
        if (generated) {
          await failUpload({
            service,
            videoId: generated.video.id,
            jobId: job?.id,
            message: error.message || "Uqload URL upload failed",
          });
        }
        results.push({ remoteUrl, error: error.message || "Unable to queue remote upload", status: "failed" });
      }
    }

    const succeeded = results.filter((result) => result.status === "published").length;
    return NextResponse.json(
      { results, succeeded, failed: results.length - succeeded },
      { status: succeeded ? (succeeded === results.length ? 200 : 207) : 422 }
    );
  } catch (error: any) {
    const status = httpErrorStatus(error.message || "");
    return NextResponse.json({ error: error.message || "URL upload failed" }, { status });
  }
}
