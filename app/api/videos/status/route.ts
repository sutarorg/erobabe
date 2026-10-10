import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getVideoProvider } from "@/lib/video/provider";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
        const { data: v } = await service.from("videos").select("*").eq("id", job.video_id).single();
        video = v;
      }
    }

    if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

    // If provider is uqload and we have provider_file_id, check real processing status
    if (video.provider_file_id && video.provider === "uqload") {
      try {
        const provider = getVideoProvider("uqload");
        if (provider.isEnabled()) {
          const info = await provider.getFileInfo(video.provider_file_id);
          // Update DB if canPlay
          if (info.canPlay && video.status === "processing") {
            await service.from("videos").update({
              status: "pending_review",
              thumbnail_url: info.thumbnailUrl || video.thumbnail_url,
              duration_seconds: info.durationSeconds || video.duration_seconds,
            }).eq("id", video.id);

            if (job) {
              await service.from("upload_jobs").update({ status: "completed" }).eq("id", job.id);
            }
          }
          return NextResponse.json({ video, job, providerInfo: info });
        }
      } catch (e: any) {
        console.warn("provider status check failed", e);
      }
    }

    return NextResponse.json({ video, job });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
