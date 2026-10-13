import { NextRequest, NextResponse } from "next/server";
import {
  assertPublicHttpUrl,
  createGeneratedVideo,
  errorMessageFrom,
  errorStatusFrom,
  failUpload,
  publishVideo,
  requireActiveAdmin,
  sourceNameFromUrl,
} from "@/lib/video/publishing";
import { removeThumbnailObject, resolveThumbnailUrl } from "@/lib/video/storage";
import { normalizeRemoteEntries } from "@/lib/video/entries";
import { classifyVideoSource, normalizePastedLink } from "@/lib/video/links";
import { describeDuplicate, findDuplicateVideos, sourceKeyOf } from "@/lib/video/duplicates";
import { generateFrameThumbnail } from "@/lib/video/frame-thumbnail";
import { tryStreamtapeThumbnailFor } from "@/lib/video/streamtape-thumbnails";

const MAX_URLS_PER_REQUEST = 20;

/**
 * Frame capture downloads part of the video, so one publish request may take a
 * while on a large batch. Raised for serverless hosts that enforce a limit.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Validates that the URL path ends with a video extension (case-insensitive).
 * Query strings are allowed — only the pathname is checked.
 *
 * Markdown wrappers (`[label](https://…)`), angle brackets, and pasted iframe
 * markup are unwrapped first, so a copied link works as-is. Player *pages*
 * (Streamtape `/v/<id>`, DoodStream `/d/<id>`, …) belong to the embed route and
 * are answered with a message that says so instead of a bare "not a file".
 */
function assertVideoUrl(urlString: string): string {
  const normalized = normalizePastedLink(urlString);
  const classified = classifyVideoSource(normalized);
  if (classified.kind === "embed") {
    throw new Error(
      `${classified.host} link is a player page, not a video file — publish it as an embed instead (it will play in the site's iframe player).`
    );
  }

  const validated = assertPublicHttpUrl(classified.url, "Video URL");
  let url: URL;
  try {
    url = new URL(validated);
  } catch {
    throw new Error("Video URL must be a valid http or https URL");
  }

  const pathname = url.pathname.toLowerCase();
  const videoExtensions = [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi", ".wmv", ".flv", ".ts", ".mpg", ".mpeg", ".3gp"];
  const hasVideoExtension = videoExtensions.some((ext) => pathname.endsWith(ext));
  if (!hasVideoExtension) {
    throw new Error(`Video URL must point to a video file (e.g. .mp4). Got: ${pathname.split("/").pop() || "(empty path)"}`);
  }

  return validated;
}

/**
 * Publishes videos from direct URLs.
 *
 * The admin pastes direct video-file links. The URL is stored in
 * `videos.playable_url` and the browser plays the video straight from the
 * original host. Only frame samples are fetched to make a thumbnail; the
 * full video is never copied to storage or re-encoded.
 *
 * `embed_url` is NULL for direct-link videos — they use a native `<video>`
 * player, not an iframe.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) {
      return NextResponse.json({ error: "Choose a category" }, { status: 400 });
    }

    // Check the raw entry count before normalisation caps it.
    const rawCount = Array.isArray(body.entries)
      ? body.entries.length
      : typeof body.urls === "string"
        ? body.urls.split(/[\r\n,]+/).filter(Boolean).length
        : 0;
    if (rawCount > MAX_URLS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Publish up to ${MAX_URLS_PER_REQUEST} videos at a time` },
        { status: 400 }
      );
    }

    const rawEntries = normalizeRemoteEntries(body);
    if (!rawEntries.length) {
      return NextResponse.json({ error: "Enter at least one direct video URL" }, { status: 400 });
    }

    // Validate and deduplicate URLs before processing.
    const validEntries: Array<{ url: string; thumbnailPath: string | null; allowDuplicate: boolean }> = [];
    const validationErrors: Array<{ url: string; error: string }> = [];

    const seen = new Set<string>();
    for (const entry of rawEntries) {
      try {
        const validatedUrl = assertVideoUrl(entry.url);
        const normalized = new URL(validatedUrl).toString();
        if (seen.has(normalized)) {
          validationErrors.push({ url: entry.url, error: "Duplicate URL — already in this batch" });
          continue;
        }
        seen.add(normalized);
        validEntries.push({ url: validatedUrl, thumbnailPath: entry.thumbnailPath, allowDuplicate: entry.allowDuplicate });
      } catch (error) {
        validationErrors.push({
          url: entry.url.slice(0, 200),
          error: errorMessageFrom(error, "Invalid video URL"),
        });
      }
    }

    if (!validEntries.length) {
      return NextResponse.json(
        { error: "No valid video URLs found", results: validationErrors },
        { status: 400 }
      );
    }

    // Duplicate detector: an exact link or the same file name already published.
    const duplicates = await findDuplicateVideos(
      service,
      validEntries.map((entry) => entry.url)
    );

    // Resolve each distinct thumbnail once, then reuse.
    const thumbnailByPath = new Map<string, string | null>();
    const results: Array<Record<string, unknown>> = [];

    for (const entry of validEntries) {
      let videoId: string | null = null;
      let generatedThumbnailUrl: string | null = null;

      const duplicate = duplicates.get(entry.url);
      if (duplicate && !entry.allowDuplicate) {
        results.push({
          url: entry.url,
          status: "skipped",
          error: describeDuplicate(duplicate),
          duplicate: { videoId: duplicate.videoId, slug: duplicate.slug, title: duplicate.title, reason: duplicate.reason },
        });
        continue;
      }

      try {
        let thumbnailUrl: string | null = null;
        let thumbnailSource: "uploaded" | "frame" | "streamtape" | "none" = "none";
        let thumbnailWarning: string | undefined;

        if (entry.thumbnailPath) {
          if (!thumbnailByPath.has(entry.thumbnailPath)) {
            thumbnailByPath.set(entry.thumbnailPath, resolveThumbnailUrl(service, user.id, entry.thumbnailPath));
          }
          thumbnailUrl = thumbnailByPath.get(entry.thumbnailPath) || null;
          if (thumbnailUrl) thumbnailSource = "uploaded";
        } else {
          // No thumbnail chosen: capture a vibrant frame from the video itself.
          try {
            thumbnailUrl = await generateFrameThumbnail(service, user.id, entry.url);
            thumbnailSource = "frame";
            generatedThumbnailUrl = thumbnailUrl;
          } catch (frameError) {
            thumbnailWarning = `Automatic thumbnail failed (${errorMessageFrom(frameError, "unknown error")}). Add one manually from the video list.`;
          }
        }

        const name = sourceNameFromUrl(entry.url);
        const generated = await createGeneratedVideo({
          service,
          userId: user.id,
          sourceName: name,
          categoryId,
          provider: "direct_url",
          thumbnailUrl,
          sourceKey: sourceKeyOf(entry.url),
        });
        videoId = generated.video.id;

        const video = await publishVideo({
          service,
          videoId: generated.video.id,
          userId: user.id,
          playableUrl: entry.url,
          embedUrl: null,
          thumbnailUrl,
        });

        // Frame capture is not always possible (an unreachable host, a host
        // that refuses range requests). When it produced nothing, fall back to
        // the matching image in the Streamtape thumbnails folder before the
        // video ever reaches a public page without one.
        if (!thumbnailUrl) {
          const auto = await tryStreamtapeThumbnailFor(service, user.id, {
            id: generated.video.id,
            slug: video.slug,
            title: video.title,
            thumbnail_url: null,
            playable_url: entry.url,
            source_key: sourceKeyOf(entry.url),
            extraNames: [name],
          });
          if (auto) {
            await service.from("videos").update({ thumbnail_url: auto.thumbnailUrl }).eq("id", generated.video.id);
            thumbnailUrl = auto.thumbnailUrl;
            thumbnailSource = "streamtape";
            thumbnailWarning = undefined;
          }
        }

        await service.from("audit_logs").insert({
          actor_id: user.id,
          action: "video_published_from_direct_url",
          target_type: "video",
          target_id: generated.video.id,
          level: "info",
          metadata: {
            provider: "direct_url",
            host: new URL(entry.url).hostname,
            has_custom_thumbnail: thumbnailSource === "uploaded",
            thumbnail_source: thumbnailSource,
            duplicate_override: Boolean(duplicate),
          },
        });

        results.push({
          url: entry.url,
          videoId: generated.video.id,
          slug: video.slug,
          title: video.title,
          description: generated.metadata.description,
          status: "published",
          metadataSource: generated.metadata.source,
          ...(generated.metadata.warning ? { metadataWarning: generated.metadata.warning } : {}),
          thumbnailUrl,
          thumbnailSource,
          ...(thumbnailWarning ? { thumbnailWarning } : {}),
        });
      } catch (publishError: unknown) {
        // If record creation failed, no row owns the generated storage object.
        if (!videoId && generatedThumbnailUrl) await removeThumbnailObject(service, generatedThumbnailUrl);
        if (videoId) {
          await failUpload({
            service,
            videoId,
            message: publishError instanceof Error ? publishError.message : "Unable to publish video",
          });
        }
        results.push({
          url: entry.url.slice(0, 200),
          status: "failed",
          error: publishError instanceof Error ? publishError.message : "Unable to publish video",
        });
      }
    }

    // Append validation errors to the results.
    for (const err of validationErrors) {
      results.push({ ...err, status: "failed" });
    }

    const succeeded = results.filter((r) => r.status === "published").length;
    const failed = results.length - succeeded;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return NextResponse.json(
      { results, succeeded, failed, skipped },
      { status: succeeded ? (failed ? 207 : 200) : 422 }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Direct URL publishing failed") },
      { status: errorStatusFrom(error) }
    );
  }
}