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
import { describeDuplicate, findDuplicateVideos, sourceKeyOf } from "@/lib/video/duplicates";
import { tryStreamtapeThumbnailFor } from "@/lib/video/streamtape-thumbnails";

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

    // Duplicate detector: the same player link, or the same file name, already published.
    // Checked on the resolved iframe address (e.g. a Streamtape /v/ page becomes its /e/ embed).
    const resolvedSources = new Map<string, string>();
    for (const entry of entries) {
      try {
        resolvedSources.set(entry.source, extractIframeSource(entry.source));
      } catch {
        // Invalid entries are reported by the per-entry validation below.
      }
    }
    const duplicates = await findDuplicateVideos(service, Array.from(resolvedSources.values()));

    for (const entry of entries) {
      let videoId: string | null = null;
      const duplicate = duplicates.get(resolvedSources.get(entry.source) || "");
      if (duplicate && !entry.allowDuplicate) {
        results.push({
          source: entry.source.slice(0, 200),
          status: "skipped",
          error: describeDuplicate(duplicate),
          duplicate: { videoId: duplicate.videoId, slug: duplicate.slug, title: duplicate.title, reason: duplicate.reason },
        });
        continue;
      }
      try {
        const embedUrl = extractIframeSource(entry.source);
        let thumbnailUrl = resolveThumbnailUrl(service, user.id, entry.thumbnailPath);
        let thumbnailSource: "uploaded" | "streamtape" | "none" = thumbnailUrl ? "uploaded" : "none";
        const generated = await createGeneratedVideo({
          service,
          userId: user.id,
          sourceName: sourceNameFromUrl(embedUrl),
          categoryId,
          provider: "embed",
          thumbnailUrl,
          sourceKey: sourceKeyOf(embedUrl),
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

        // An embedded player exposes no frames to capture, so the only
        // automatic source is the matching image in the Streamtape thumbnails
        // folder. Best-effort: publishing never fails over a missing image.
        if (!thumbnailUrl) {
          const auto = await tryStreamtapeThumbnailFor(service, user.id, {
            id: generated.video.id,
            slug: video.slug,
            title: video.title,
            thumbnail_url: null,
            embed_url: embedUrl,
            source_key: sourceKeyOf(embedUrl),
            extraNames: [sourceNameFromUrl(embedUrl)],
          });
          if (auto) {
            await service.from("videos").update({ thumbnail_url: auto.thumbnailUrl }).eq("id", generated.video.id);
            thumbnailUrl = auto.thumbnailUrl;
            thumbnailSource = "streamtape";
          }
        }
        await service.from("audit_logs").insert({
          actor_id: user.id,
          action: "video_published_from_embed",
          target_type: "video",
          target_id: generated.video.id,
          level: "info",
          metadata: {
            provider: "embed",
            host: new URL(embedUrl).hostname,
            has_custom_thumbnail: thumbnailSource === "uploaded",
            thumbnail_source: thumbnailSource,
            duplicate_override: Boolean(duplicate),
          },
        });

        results.push({
          source: embedUrl,
          videoId: generated.video.id,
          slug: video.slug,
          title: video.title,
          description: generated.metadata.description,
          status: "published",
          thumbnailUrl,
          thumbnailSource,
          ...(!thumbnailUrl ? { thumbnailWarning: "Embedded players do not expose video frames and no image in the Streamtape thumbnails folder matched this video. Add one manually from the video list." } : {}),
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
    const skipped = results.filter((result) => result.status === "skipped").length;
    return NextResponse.json(
      { results, succeeded, failed: results.length - succeeded, skipped },
      { status: succeeded ? (succeeded === results.length ? 200 : 207) : 422 }
    );
  } catch (error: any) {
    const status = httpErrorStatus(error.message || "");
    return NextResponse.json({ error: error.message || "Unable to publish embed" }, { status });
  }
}
