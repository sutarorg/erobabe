import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDownloadUrl } from "@/lib/video/streamtape";
import { safeStreamtapeMediaUrl, selectPlaybackSource } from "@/lib/video/playback";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

function reply(body: Record<string, unknown>, status = 200) {
  // Ticketed links must never be persisted or shared by a browser/CDN cache.
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Resolve only a published catalog entry, never a caller-supplied URL/file ID. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return reply({ error: "Invalid video ID" }, 400);
  }

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

    // Official API only. No embed scraping, ad scripts, popup permissions,
    // redirects to player pages, or streaming huge files through this server.
    const url = safeStreamtapeMediaUrl(await createDownloadUrl(source.fileId));
    return reply({ url });
  } catch {
    // Upstream messages/URLs may contain secrets. Never echo them to visitors.
    return reply({ error: "Ad-free playback is unavailable from this host. Please try again later." }, 503);
  }
}
