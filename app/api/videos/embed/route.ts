import { NextRequest, NextResponse } from "next/server";
import {
  createGeneratedVideo,
  extractIframeSource,
  failUpload,
  httpErrorStatus,
  publishVideo,
  requireActiveAdmin,
  sourceNameFromUrl,
} from "@/lib/video/publishing";
import { resolveThumbnailUrl } from "@/lib/video/storage";
import { normalizeEmbedEntries } from "@/lib/video/entries";

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

    const entries = normalizeEmbedEntries(body);
    if (!entries.length) return NextResponse.json({ error: "Paste an iframe URL or iframe embed code" }, { status: 400 });

    const results: Array<Record<string, unknown>> = [];

    for (const entry of entries) {
      let videoId: string | null = null;
      try {
        const embedUrl = extractIframeSource(entry.source);
        const thumbnailUrl = resolveThumbnailUrl(service, user.id, entry.thumbnailPath);
        const generated = await createGeneratedVideo({
          service,
          userId: user.id,
          sourceName: sourceNameFromUrl(embedUrl),
          categoryId,
          provider: "embed",
          thumbnailUrl,
        });
        videoId = generated.video.id;

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
          metadata: { provider: "embed", host: new URL(embedUrl).hostname, has_custom_thumbnail: Boolean(thumbnailUrl) },
        });

        results.push({
          source: embedUrl,
          videoId: generated.video.id,
          slug: video.slug,
          title: video.title,
          status: "published",
          metadataSource: generated.metadata.source,
          ...(generated.metadata.warning ? { metadataWarning: generated.metadata.warning } : {}),
        });
      } catch (publishError: any) {
        if (videoId) {
          await failUpload({ service, videoId, message: publishError.message || "Unable to publish embed" });
        }
        results.push({
          source: entry.source.slice(0, 200),
          status: "failed",
          error: publishError.message || "Unable to publish embed",
        });
      }
    }

    const succeeded = results.filter((result) => result.status === "published").length;
    return NextResponse.json(
      { results, succeeded, failed: results.length - succeeded },
      { status: succeeded ? (succeeded === results.length ? 200 : 207) : 422 }
    );
  } catch (error: any) {
    const status = httpErrorStatus(error.message || "");
    return NextResponse.json({ error: error.message || "Unable to publish embed" }, { status });
  }
}
