import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { errorMessageFrom, errorStatusFrom } from "@/lib/video/publishing";

/**
 * Reads the state of a video.
 *
 * For direct_url records the video is already published — no provider
 * conversion or reconciliation is needed. Legacy records from retired
 * integrations (streamtape, ufoload, uqload) are returned as stored history:
 * their playback/embed URLs still render, but nothing contacts the retired
 * provider APIs.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).single();
    if (!profile || profile.role !== "admin" || profile.status !== "active") {
      return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
    }

    const url = new URL(req.url);
    const videoId = url.searchParams.get("videoId");
    const jobId = url.searchParams.get("jobId");
    if (!videoId && !jobId) return NextResponse.json({ error: "videoId or jobId required" }, { status: 400 });

    const service = createServiceClient();
    let video: any = null;
    let job: any = null;

    if (videoId) {
      const { data } = await service.from("videos").select("*").eq("id", videoId).single();
      video = data;
    }
    if (jobId) {
      const { data } = await service.from("upload_jobs").select("*").eq("id", jobId).single();
      job = data;
      if (!video && job?.video_id) {
        const { data: relatedVideo } = await service.from("videos").select("*").eq("id", job.video_id).single();
        video = relatedVideo;
      }
    }

    if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

    let providerState: "ready" | "processing" | "failed" | null = null;
    let note: string | null = null;

    if (video.provider === "direct_url") {
      providerState = "ready";
      note = "This video plays directly from the source URL — no provider conversion needed.";
    } else if (video.provider === "streamtape") {
      note = "Unsupported legacy provider. Records are preserved; provider APIs are no longer contacted.";
    } else if (video.provider === "ufoload") {
      note =
        "This video was uploaded through the retired UFOLOAD integration. Its stored playback data is kept as-is and is not refreshed.";
    } else if (video.provider === "uqload") {
      note =
        "This video was uploaded to the retired Uqload integration. Its stored playback data is kept as-is and is not refreshed.";
    }

    return NextResponse.json({ video, job, providerInfo: null, providerState, note });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessageFrom(error, "Status check failed") }, { status: errorStatusFrom(error) });
  }
}