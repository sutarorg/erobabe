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
import { resolveThumbnailUrl } from "@/lib/video/storage";
import { normalizeRemoteEntries } from "@/lib/video/entries";

const MAX_URLS_PER_REQUEST = 20;

/**
 * Validates that the URL path ends with a video extension (case-insensitive).
 * Query strings are allowed — only the pathname is checked.
 */
function assertVideoUrl(urlString: string): string {
  const validated = assertPublicHttpUrl(urlString, "Video URL");
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
 * original host — Erobabe never downloads, transfers, or re-encodes the
 * video bytes.
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
    const validEntries: Array<{ url: string; thumbnailPath: string | null }> = [];
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
        validEntries.push({ url: validatedUrl, thumbnailPath: entry.thumbnailPath });
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

    // Resolve each distinct thumbnail once, then reuse.
    const thumbnailByPath = new Map<string, string | null>();
    const results: Array<Record<string, unknown>> = [];

    for (const entry of validEntries) {
      let videoId: string | null = null;
      try {
        let thumbnailUrl: string | null = null;
        if (entry.thumbnailPath) {
          if (!thumbnailByPath.has(entry.thumbnailPath)) {
            thumbnailByPath.set(entry.thumbnailPath, resolveThumbnailUrl(service, user.id, entry.thumbnailPath));
          }
          thumbnailUrl = thumbnailByPath.get(entry.thumbnailPath) || null;
        }

        const name = sourceNameFromUrl(entry.url);
        const generated = await createGeneratedVideo({
          service,
          userId: user.id,
          sourceName: name,
          categoryId,
          provider: "direct_url",
          thumbnailUrl,
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

        await service.from("audit_logs").insert({
          actor_id: user.id,
          action: "video_published_from_direct_url",
          target_type: "video",
          target_id: generated.video.id,
          level: "info",
          metadata: {
            provider: "direct_url",
            host: new URL(entry.url).hostname,
            has_custom_thumbnail: Boolean(thumbnailUrl),
          },
        });

        results.push({
          url: entry.url,
          videoId: generated.video.id,
          slug: video.slug,
          title: video.title,
          status: "published",
          metadataSource: generated.metadata.source,
          ...(generated.metadata.warning ? { metadataWarning: generated.metadata.warning } : {}),
        });
      } catch (publishError: unknown) {
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

    return NextResponse.json(
      { results, succeeded, failed },
      { status: succeeded ? (failed ? 207 : 200) : 422 }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Direct URL publishing failed") },
      { status: errorStatusFrom(error) }
    );
  }
}