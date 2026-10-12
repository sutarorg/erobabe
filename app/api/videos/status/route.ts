import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getVideoProvider } from "@/lib/video/provider";
import { StreamtapeProvider } from "@/lib/video/streamtape";
import { reconcileStreamtapeRecord } from "@/lib/video/streamtape-flow";
import { errorMessageFrom, errorStatusFrom } from "@/lib/video/publishing";
import { removeTransitObject } from "@/lib/video/storage";
import { redactSecrets } from "@/lib/video/streamtape-protocol";

/**
 * Reads (and reconciles) the state of an upload job or video.
 *
 * For Streamtape records this is the only place a video becomes public: the
 * stored row is compared against the provider's own file/import state, and the
 * row is promoted only when Streamtape reports the file converted. A file that
 * failed conversion keeps its actionable reason and stays private.
 *
 * Records from retired integrations (`provider: "ufoload"` / `"uqload"`) are
 * returned as stored, untouched: their playback/embed URLs still render, but
 * nothing contacts the retired provider APIs.
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

    // Polling by videoId must still update the upload job (state, progress,
    // provider error, transit cleanup), so look up the job that produced it.
    if (!job) {
      const { data } = await service
        .from("upload_jobs")
        .select("*")
        .eq("video_id", video.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      job = data ?? null;
    }

    let providerInfo: unknown = null;
    let providerState: "ready" | "processing" | "failed" | null = null;
    let note: string | null = null;

    if (video.provider === "streamtape") {
      try {
        const factory = getVideoProvider("streamtape");
        if (!(factory instanceof StreamtapeProvider)) throw new Error("Streamtape provider is not available");
        const provider = factory;

        if (!provider.isEnabled()) {
          note = provider.disabledReason() || "Streamtape is not configured";
        } else {
          const outcome = await reconcileStreamtapeRecord({ service, userId: user.id, provider, video, job });
          providerInfo = "providerInfo" in outcome ? outcome.providerInfo ?? null : null;
          providerState = outcome.state;

          // Reload the rows the reconciliation may have just updated.
          const [{ data: freshVideo }, { data: freshJob }] = await Promise.all([
            service.from("videos").select("*").eq("id", video.id).single(),
            job?.id ? service.from("upload_jobs").select("*").eq("id", job.id).single() : Promise.resolve({ data: job }),
          ]);
          if (freshVideo) video = freshVideo;
          if (freshJob) job = freshJob;

          if (outcome.state === "failed") note = outcome.error;
          else if (outcome.state === "processing") note = outcome.note;
          else note = "Streamtape confirmed this video is ready.";

          // The provider has the file now — drop any transit copy (best effort).
          if (outcome.state === "ready" && job?.storage_path) {
            await removeTransitObject(service, job.storage_path);
            await service.from("upload_jobs").update({ storage_path: null }).eq("id", job.id);
          }
        }
      } catch (error: unknown) {
        // A provider hiccup must never 500 the admin UI: report it as a note
        // and leave the stored row exactly as it is.
        console.warn(
          `[video-status] Streamtape reconciliation failed: ${redactSecrets(errorMessageFrom(error, "unknown error"), [
            process.env.STREAMTAPE_API_KEY,
            process.env.STREAMTAPE_LOGIN,
          ])}`
        );
        note = redactSecrets(errorMessageFrom(error, "Could not reach Streamtape for this video."), [
          process.env.STREAMTAPE_API_KEY,
          process.env.STREAMTAPE_LOGIN,
        ]);
      }
    } else if (video.provider === "ufoload") {
      note =
        "This video was uploaded through the retired UFOLOAD integration. Its stored playback data is kept as-is and is not refreshed.";
    } else if (video.provider === "uqload") {
      note =
        "This video was uploaded to the retired Uqload integration. Its stored playback data is kept as-is and is not refreshed.";
    }

    return NextResponse.json({ video, job, providerInfo, providerState, note });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessageFrom(error, "Status check failed") }, { status: errorStatusFrom(error) });
  }
}
