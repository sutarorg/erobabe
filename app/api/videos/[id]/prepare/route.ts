import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectPlaybackSource } from "@/lib/video/playback";
import { warmStreamtapeTicket } from "@/lib/video/streamtape-tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Warm-up for the watch page's native player.
 *
 * The visitor's browser asks this endpoint (and requests the media element
 * itself) as soon as the page renders, so by the time someone presses Play the
 * server already holds a valid, allowlisted media link. The play click then
 * only has to relay bytes instead of resolving a provider ticket first — that
 * is the difference between "Preparing video…" and an instant first frame.
 *
 * Access is re-checked here exactly like `/playback`: published, public,
 * rights-cleared and moderation-approved, read through the visitor's own
 * Supabase client. This route never returns a media URL, only readiness, so it
 * cannot be used to discover a source the watch page would not already serve.
 */
function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!VIDEO_ID.test(id)) return reply({ ready: false, reason: "invalid_id" }, 400);

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
    if (error || !video) return reply({ ready: false, reason: "not_found" }, 404);

    const source = selectPlaybackSource(video.playable_url, video.embed_url);
    if (source.kind === "missing") return reply({ ready: false, reason: "unavailable" }, 422);
    // Direct files and third-party embeds are fetched by the browser itself;
    // there is nothing to warm on this side. A Streamtape record without a file
    // id has no media to resolve, exactly like `/playback` answers 422 for it.
    if (source.kind !== "streamtape") return reply({ ready: true, provider: source.kind });
    if (!source.fileId) return reply({ ready: false, reason: "unavailable" }, 422);

    const ready = await warmStreamtapeTicket(source.fileId);
    return reply(
      ready ? { ready: true, provider: "streamtape" } : { ready: false, reason: "unavailable" },
      ready ? 200 : 503
    );
  } catch {
    // Never echo provider messages, URLs or credentials to a visitor.
    return reply({ ready: false, reason: "unavailable" }, 503);
  }
}
