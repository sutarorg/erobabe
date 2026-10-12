import { NextRequest } from "next/server";
import { getVideoProvider } from "@/lib/video/provider";
import type { VideoProvider } from "@/lib/video/ufoload";
import { RouteError } from "@/lib/video/errors";
import { requireActiveAdmin } from "@/lib/video/publishing";
import { loadJob, reconcileJob, viewJob, type JobStatusView, type UploadJobRow } from "@/lib/video/processing";
import { errorResponse, noStoreJson } from "@/lib/video/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BATCH = 20;

/**
 * Processing status for the admin page.
 *
 *   ?jobIds=a,b,c   → `{ jobs: JobStatusView[] }` (up to 20) — what the upload page polls
 *   ?jobId= / ?videoId=  → `{ video, job, status }`
 *
 * Each call refreshes the jobs it returns from UFOLOAD (`reconcileJob`), which
 * is how an upload or import moves from `processing` to a published video
 * without anything waiting inside a request. It does not wait for UFOLOAD: a
 * file that is still encoding is simply reported as `processing`.
 */
export async function GET(req: NextRequest) {
  try {
    const { service } = await requireActiveAdmin();
    const params = new URL(req.url).searchParams;

    // Without a usable provider configuration we can still report what is stored.
    let provider: VideoProvider | null = null;
    let providerProblem = "";
    try {
      provider = getVideoProvider();
      provider.assertEnabled();
    } catch (error) {
      provider = null;
      const known = error as { details?: string; message?: string };
      providerProblem = known.details || known.message || "the video provider is not configured";
    }
    const refresh = (job: UploadJobRow): Promise<JobStatusView> =>
      provider ? reconcileJob({ service, provider, job }) : viewJob(service, job, `Status cannot be refreshed: ${providerProblem}`);

    const jobIds = (params.get("jobIds") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (jobIds.length) {
      if (jobIds.length > MAX_BATCH) throw new RouteError(400, `Ask for at most ${MAX_BATCH} jobs at a time`);
      const { data } = await service.from("upload_jobs").select("*").in("id", jobIds);
      const rows = (data as UploadJobRow[] | null) || [];
      const jobs: JobStatusView[] = [];
      for (const id of jobIds) {
        const job = rows.find((row) => row.id === id);
        if (job) jobs.push(await refresh(job));
      }
      return noStoreJson({ jobs });
    }

    const videoId = params.get("videoId");
    const jobId = params.get("jobId");
    if (!videoId && !jobId) throw new RouteError(400, "videoId, jobId or jobIds required");

    let job: UploadJobRow | null = jobId ? await loadJob(service, jobId) : null;
    if (!job && videoId) {
      const { data } = await service
        .from("upload_jobs")
        .select("*")
        .eq("video_id", videoId)
        .order("created_at", { ascending: false })
        .limit(1);
      job = (Array.isArray(data) ? (data[0] as UploadJobRow | undefined) : undefined) ?? null;
    }

    const lookupId = videoId || job?.video_id || null;
    if (!job && !lookupId) throw new RouteError(404, "Video not found");

    const status = job ? await refresh(job) : null;

    let video = null;
    if (lookupId) {
      const { data } = await service.from("videos").select("*").eq("id", lookupId).maybeSingle();
      video = data ?? null;
    }
    if (!video && !job) throw new RouteError(404, "Video not found");

    return noStoreJson({ video, job: job ? await loadJob(service, job.id) : null, status });
  } catch (error) {
    return errorResponse(error, "Could not read the video status");
  }
}
