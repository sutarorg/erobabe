import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, errorStatusFrom, findUploadJobForSession, markVideoFailed, requireActiveAdmin, updateUploadJob } from "@/lib/video/publishing";
import { StreamtapeProvider } from "@/lib/video/streamtape";
import { redactSecrets } from "@/lib/video/streamtape-protocol";

/**
 * Cancels an in-flight Streamtape upload or remote import.
 *
 * - Direct uploads: the browser already aborted the XHR, which closes the
 *   relay connection and makes Streamtape drop the partial body — there is no
 *   provider-side upload session to delete (Streamtape documents none). This
 *   route only marks the stored job cancelled so no stale session can later be
 *   completed into a published video.
 * - Remote imports: also asks Streamtape to remove the task
 *   (`remotedl/remove?id=…` — never `id=all`). Removal is best effort: a task
 *   that already finished or expired is not an error for the admin who
 *   clicked Cancel.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();

    const body = await req.json().catch(() => null);
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    const uploadId = typeof body?.uploadId === "string" ? body.uploadId.trim() : "";
    if (!jobId && !uploadId) {
      return NextResponse.json({ error: "jobId (or the upload session id) is required" }, { status: 400 });
    }

    let job: { id: string; video_id: string | null; provider_import_id?: string | null } | null = null;
    if (jobId) {
      const { data } = await service
        .from("upload_jobs")
        .select("id, video_id, provider_import_id, created_by, provider")
        .eq("id", jobId)
        .eq("created_by", user.id)
        .single();
      job = data ?? null;
    } else {
      job = await findUploadJobForSession(service, user.id, uploadId, "streamtape");
    }
    if (!job) return NextResponse.json({ error: "Upload session not found" }, { status: 404 });

    // Cancel the provider-side task first (imports only), then invalidate the row.
    if (job.provider_import_id) {
      const provider = new StreamtapeProvider();
      if (provider.isEnabled()) {
        try {
          await provider.removeRemoteUpload(job.provider_import_id);
        } catch (error: unknown) {
          // Best effort — the stored state below still cancels the flow.
          console.warn(
            `[streamtape-cancel] remotedl/remove failed: ${redactSecrets(errorMessageFrom(error, "unknown error"), [
              process.env.STREAMTAPE_API_KEY,
              process.env.STREAMTAPE_LOGIN,
            ])}`
          );
        }
      }
    }

    // The video row (when one exists) goes private first; the job row is then
    // parked as `cancelled` so no stale session can ever be completed.
    if (job.video_id) {
      await markVideoFailed({
        service,
        videoId: job.video_id,
        message: "Upload cancelled by an administrator.",
      });
    }
    await updateUploadJob(service, job.id, {
      status: "cancelled",
      provider_status: "cancelled",
      error_message: null,
    });

    return NextResponse.json({ jobId: job.id, status: "cancelled", importRemoved: Boolean(job.provider_import_id) });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessageFrom(error, "Could not cancel the upload") }, { status: errorStatusFrom(error) });
  }
}

/** Marks the stored job as cancelled — kept for DELETE callers (`?jobId=`). */
export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const jobId = new URL(req.url).searchParams.get("jobId") || "";
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

    const { data } = await service
      .from("upload_jobs")
      .select("id, video_id, provider_import_id")
      .eq("id", jobId)
      .eq("created_by", user.id)
      .single();
    if (!data) return NextResponse.json({ error: "Upload session not found" }, { status: 404 });

    await updateUploadJob(service, jobId, { status: "cancelled", provider_status: "cancelled" });
    if (data.video_id) {
      await markVideoFailed({ service, videoId: data.video_id, message: "Upload cancelled by an administrator." });
    }
    return NextResponse.json({ jobId, status: "cancelled" });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessageFrom(error, "Could not update the upload job") }, { status: errorStatusFrom(error) });
  }
}
