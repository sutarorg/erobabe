import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getVideoProvider } from "@/lib/video/provider";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
        const { data: relatedVideo } = await service.from("videos").select("*").eq("id", job.video_id).single();
        video = relatedVideo;
      }
    }

    if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

    if (video.provider_file_id && video.provider === "uqload") {
      try {
        const provider = getVideoProvider("uqload");
        if (provider.isEnabled()) {
          const providerInfo = await provider.getFileInfo(video.provider_file_id);
          if (providerInfo.canPlay) {
            const updates: Record<string, unknown> = {
              thumbnail_url: video.thumbnail_url || providerInfo.thumbnailUrl || null,
              duration_seconds: providerInfo.durationSeconds || video.duration_seconds || null,
              playable_url: provider.getPlayableUrl(video.provider_file_id),
              embed_url: provider.getEmbedUrl(video.provider_file_id),
            };
            if (video.status !== "published") {
              updates.status = "published";
              updates.visibility = "public";
              updates.rights_status = "cleared";
              updates.moderation_status = "approved";
              updates.published_at = video.published_at || new Date().toISOString();
            }
            const { data: updatedVideo } = await service
              .from("videos")
              .update(updates)
              .eq("id", video.id)
              .select("*")
              .single();
            video = updatedVideo || video;
            if (job) await service.from("upload_jobs").update({ status: "completed" }).eq("id", job.id);
          }
          return NextResponse.json({ video, job, providerInfo });
        }
      } catch (error) {
        console.warn("provider status check failed", error);
      }
    }

    return NextResponse.json({ video, job });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
