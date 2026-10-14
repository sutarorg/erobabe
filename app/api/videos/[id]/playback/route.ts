import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectPlaybackSource } from "@/lib/video/playback";
import { forgetStreamtapeTicket, resolveStreamtapeTicket } from "@/lib/video/streamtape-tickets";
import { streamStreamtapeMedia, validMediaRange } from "@/lib/video/streamtape-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function reply(body: Record<string, unknown>, status = 200) {
  // Ticketed links must never be persisted or shared by a browser/CDN cache.
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Resolve only a published catalog entry, never a caller-supplied URL/file ID. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return reply({ error: "Invalid video ID" }, 400);
  }

  const range = req.headers.get("range");
  if (range && !validMediaRange(range)) return reply({ error: "Invalid byte range" }, 400);

  try {
    const supabase = await createClient();
    const { data: video, error } = await supabase.from("videos")
      .select("playable_url, embed_url")
      .eq("id", id)
      .eq("status", "published")
      .eq("visibility", "public")
      .eq("rights_status", "cleared")
      .eq("moderation_status", "approved")
      .single();
    if (error || !video) return reply({ error: "Video not found" }, 404);

    const source = selectPlaybackSource(video.playable_url, video.embed_url);
    if (source.kind !== "streamtape" || !source.fileId) {
      return reply({ error: "No Streamtape media source is available for this video." }, 422);
    }

    // Download tickets can be bound to the issuing server's IP. Returning the
    // URL to a different browser IP produces a 403 / MEDIA_ERR_SRC_NOT_SUPPORTED.
    // Resolve and consume it here, for the initial request and for every seek.
    //
    // The link itself is cached for a few minutes (`streamtape-tickets`), so the
    // click that follows the page's own preload — and every byte range after it
    // — starts streaming immediately instead of paying two API round trips
    // first. `POST /api/videos/{id}/prepare` warms that cache even earlier.
    if (req.signal.aborted) throw new Error("Request cancelled");
    const ticket = await resolveStreamtapeTicket(source.fileId);
    if (req.signal.aborted) throw new Error("Request cancelled");
    try {
      return await streamStreamtapeMedia(ticket.url, req);
    } catch (error) {
      // A cached link can be refused by the media host (expired, already
      // consumed, revoked). Nothing has been sent yet at this point, so drop it
      // and stream from one freshly issued link before failing the visitor.
      if (!ticket.fromCache || req.signal.aborted) throw error;
      forgetStreamtapeTicket(source.fileId);
      const fresh = await resolveStreamtapeTicket(source.fileId);
      return await streamStreamtapeMedia(fresh.url, req);
    }
  } catch {
    // Upstream messages/URLs may contain secrets. Never echo them to visitors.
    return reply({ error: "Ad-free playback is unavailable from this host. Please try again later." }, 503);
  }
}

// Metadata probes get the same access checks and media headers without a body.
export const HEAD = GET;
