import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectPlaybackSource } from "@/lib/video/playback";
import {
  getStreamtapeLink,
  invalidateStreamtapeLink,
  prepareStreamtapeLink,
  recallPlaybackAccess,
  rememberPlaybackAccess,
} from "@/lib/video/playback-cache";
import { StreamtapeMediaError, streamStreamtapeMedia, validMediaRange } from "@/lib/video/streamtape-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAVAILABLE = "Ad-free playback is unavailable from this host. Please try again later.";

function reply(body: Record<string, unknown>, status = 200) {
  // Ticketed links must never be persisted or shared by a browser/CDN cache.
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

type Access = { fileId: string } | { response: Response };

/**
 * Resolve only a published catalog entry, never a caller-supplied URL/file ID.
 * A positive decision is reused briefly so range and seek requests do not each
 * wait on the database; failures are never cached.
 */
async function playbackAccess(id: string): Promise<Access> {
  const cached = recallPlaybackAccess(id);
  if (cached) return { fileId: cached };

  const supabase = await createClient();
  const { data: video, error } = await supabase.from("videos")
    .select("playable_url, embed_url")
    .eq("id", id)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("rights_status", "cleared")
    .eq("moderation_status", "approved")
    .single();
  if (error || !video) return { response: reply({ error: "Video not found" }, 404) };

  const source = selectPlaybackSource(video.playable_url, video.embed_url);
  if (source.kind !== "streamtape" || !source.fileId) {
    return { response: reply({ error: "No Streamtape media source is available for this video." }, 422) };
  }
  rememberPlaybackAccess(id, source.fileId);
  return { fileId: source.fileId };
}

/**
 * Download links can be bound to the issuing server's IP. Returning the URL to
 * a different browser IP produces a 403 / MEDIA_ERR_SRC_NOT_SUPPORTED, so the
 * link is resolved and consumed here. It is resolved once and reused for every
 * range/seek request: a new ticket costs Streamtape's ~10 s `wait_time`.
 */
async function relay(fileId: string, req: NextRequest): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const { link, cached } = await getStreamtapeLink(fileId);
    try {
      return await streamStreamtapeMedia(link.url, req);
    } catch (error) {
      if (!(error instanceof StreamtapeMediaError) || !error.retryable) throw error;
      // Only a link resolved before this request can have expired; retrying a
      // brand-new one would just repeat the handshake and fail the same way.
      const retrying = cached && attempt === 0 && !req.signal.aborted;
      // Never hand a rejected link to the next request.
      invalidateStreamtapeLink(link, { status: error.status, retrying });
      if (!retrying) throw error;
    }
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!VIDEO_ID.test(id)) return reply({ error: "Invalid video ID" }, 400);

  const range = req.headers.get("range");
  if (range && !validMediaRange(range)) return reply({ error: "Invalid byte range" }, 400);

  try {
    const access = await playbackAccess(id);
    if ("response" in access) return access.response;
    if (req.signal.aborted) throw new Error("Request cancelled");
    return await relay(access.fileId, req);
  } catch {
    // Upstream messages/URLs may contain secrets. Never echo them to visitors.
    return reply({ error: UNAVAILABLE }, 503);
  }
}

// Metadata probes get the same access checks and media headers without a body.
export const HEAD = GET;

/**
 * Prepare playback ahead of the Play button: the watch page calls this when it
 * opens, so Streamtape's ticket wait happens while the visitor is still reading
 * the page. It answers only once the link is ready (or with an error) and never
 * returns the link itself.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!VIDEO_ID.test(id)) return reply({ error: "Invalid video ID" }, 400);

  try {
    const access = await playbackAccess(id);
    if ("response" in access) return access.response;
    await prepareStreamtapeLink(access.fileId);
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return reply({ error: UNAVAILABLE }, 503);
  }
}
