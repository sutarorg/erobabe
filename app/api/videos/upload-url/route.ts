import { NextRequest, NextResponse } from "next/server";
import { UqloadProvider } from "@/lib/video/provider";
import {
  assertPublicHttpUrl,
  completeUploadJob,
  createGeneratedVideo,
  createUploadJob,
  failUpload,
  httpErrorStatus,
  publishVideo,
  requireActiveAdmin,
  sourceNameFromUrl,
} from "@/lib/video/publishing";
import { resolveThumbnailUrl } from "@/lib/video/storage";
import { normalizeRemoteEntries } from "@/lib/video/entries";

const MAX_URLS_PER_REQUEST = 20;

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

    const rawEntries = normalizeRemoteEntries(body);
    const urls = Array.from(new Set(rawEntries.map((entry) => assertPublicHttpUrl(entry.url, "Remote video URL"))));
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

    // Resolve each distinct thumbnail once, then reuse it for its URLs.
    const thumbnailByPath = new Map<string, string | null>();
    const results: Array<Record<string, unknown>> = [];

    for (const entry of rawEntries) {
      const remoteUrl = assertPublicHttpUrl(entry.url, "Remote video URL");
      let generated: Awaited<ReturnType<typeof createGeneratedVideo>> | null = null;
      let job: any = null;
      try {
        let thumbnailUrl: string | null = null;
        if (entry.thumbnailPath) {
          if (!thumbnailByPath.has(entry.thumbnailPath)) {
            thumbnailByPath.set(entry.thumbnailPath, resolveThumbnailUrl(service, user.id, entry.thumbnailPath));
          }
          thumbnailUrl = thumbnailByPath.get(entry.thumbnailPath) || null;
        }

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
          metadata: { provider: "uqload", host: new URL(remoteUrl).hostname, has_custom_thumbnail: Boolean(thumbnailUrl) },
        });

        results.push({
          remoteUrl,
          videoId: generated.video.id,
          jobId: job.id,
          providerFileId: result.providerFileId,
          title: video.title,
          status: "published",
          metadataSource: generated.metadata.source,
          ...(generated.metadata.warning ? { metadataWarning: generated.metadata.warning } : {}),
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
