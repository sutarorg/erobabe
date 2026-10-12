import { NextRequest } from "next/server";
import { getVideoProvider } from "@/lib/video/provider";
import { ProviderApiError, RouteError } from "@/lib/video/errors";
import { MAX_VIDEO_SIZE, formatBytes, looksLikeVideo } from "@/lib/video/limits";
import { createUploadJob, failUpload, requireActiveAdmin } from "@/lib/video/publishing";
import { errorResponse, loadOwnUploadJob, noStoreJson } from "@/lib/video/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Direct-upload sessions: the server half of the browser → UFOLOAD upload.
 *
 *   POST    start a session. The server asks UFOLOAD to initialise the upload with
 *           the server-only API key and returns ONLY what the browser needs to
 *           send the bytes itself: the upload id, the node URL UFOLOAD returned,
 *           the grant (`authorization`), the chunk size, the byte ceiling and the
 *           expiry. The API key never leaves the server and no video byte ever
 *           passes through this host (serverless bodies are capped at a few MB).
 *   GET     keep the session alive (`?jobId=`): UFOLOAD releases an upload slot
 *           after 15 minutes without a call to its state endpoint, so a long
 *           transfer must be refreshed — through us, because the key is ours.
 *   DELETE  cancel the session (`?jobId=`) and release UFOLOAD's slot.
 *
 * Registering the finished upload is `POST /api/videos/upload`.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();

    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      throw new RouteError(415, "Send JSON, not the file itself", {
        details: "Video bytes go straight from the browser to UFOLOAD's upload node; this route only starts the session.",
      });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new RouteError(400, "Invalid request");

    const fileName = String(body.fileName ?? "").trim().slice(0, 240);
    const fileSize = Number(body.fileSize);
    const mimeType = String(body.mimeType ?? "").trim().slice(0, 100);
    const categoryId = String(body.categoryId ?? "").trim();

    if (!fileName) throw new RouteError(400, "fileName is required");
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) throw new RouteError(400, "fileSize must be the exact size of the file in bytes");
    if (fileSize > MAX_VIDEO_SIZE) {
      throw new RouteError(413, `Video file is too large (max ${formatBytes(MAX_VIDEO_SIZE).replace(".00", "")})`, { code: "file_too_large" });
    }
    if (!looksLikeVideo(fileName, mimeType)) throw new RouteError(400, "Select a video file (MP4, WebM, MOV, MKV…)");
    if (!categoryId) throw new RouteError(400, "Choose a category");

    // Fail before a single byte is sent, not after a 2 GB upload.
    const { data: category } = await service.from("categories").select("id").eq("id", categoryId).maybeSingle();
    if (!category) throw new RouteError(400, "Choose a valid category");

    const provider = getVideoProvider();
    provider.assertEnabled();

    const grant = await provider.createDirectUpload({ filename: fileName, size: fileSize, mimeType });

    let job;
    try {
      job = await createUploadJob({
        service,
        userId: user.id,
        fileName,
        fileSize,
        providerUploadId: grant.uploadId,
        status: "uploading",
      });
    } catch (error) {
      // Do not leave a granted-but-untracked upload occupying one of UFOLOAD's slots.
      await provider.cancelDirectUpload(grant.uploadId).catch(() => {});
      throw error;
    }

    return noStoreJson({
      jobId: job.id,
      uploadId: grant.uploadId,
      uploadUrl: grant.url,
      authorization: grant.authorization,
      chunkSize: grant.chunkSize,
      maxBytes: grant.maxBytes,
      expiresAt: grant.expiresAt,
    });
  } catch (error) {
    return errorResponse(error, "Could not start a UFOLOAD upload");
  }
}

export async function GET(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const job = await loadOwnUploadJob(service, new URL(req.url).searchParams.get("jobId"), user.id);

    // Only a session that is still being sent has anything to keep alive.
    if (job.status !== "uploading" || !job.provider_upload_id || job.provider_file_id) {
      return noStoreJson({ state: job.status === "failed" || job.status === "cancelled" ? "aborted" : "completed", jobStatus: job.status });
    }

    const provider = getVideoProvider();
    provider.assertEnabled();
    const state = await provider.getDirectUploadState(job.provider_upload_id);

    const now = new Date().toISOString();
    if (state.state === "failed" || state.state === "aborted") {
      await failUpload({
        service,
        jobId: job.id,
        status: "cancelled",
        message: `UFOLOAD closed this upload session (${state.state}). Select the file again to restart.`,
      });
      return noStoreJson({ state: state.state, jobStatus: "cancelled" });
    }

    // Calling the state endpoint is what keeps the slot; recording it is what
    // stops reconciliation from treating the session as abandoned.
    await service.from("upload_jobs").update({ last_checked_at: now, provider_status: `upload:${state.state}` }).eq("id", job.id);
    return noStoreJson({ state: state.state, jobStatus: job.status });
  } catch (error) {
    return errorResponse(error, "Could not refresh the upload session");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const job = await loadOwnUploadJob(service, new URL(req.url).searchParams.get("jobId"), user.id);

    if (job.video_id || job.provider_file_id || !job.provider_upload_id) {
      throw new RouteError(409, "This upload has already been completed and can no longer be cancelled", { code: "already_completed" });
    }
    if (job.status !== "uploading") return noStoreJson({ cancelled: true, jobStatus: job.status });

    const provider = getVideoProvider();
    try {
      await provider.cancelDirectUpload(job.provider_upload_id);
    } catch (error) {
      // 404: UFOLOAD already forgot the session (expired) — the goal is met.
      if (!(error instanceof ProviderApiError && error.status === 404)) throw error;
    }
    await failUpload({ service, jobId: job.id, status: "cancelled", message: "Cancelled by the admin before it finished." });
    return noStoreJson({ cancelled: true, jobStatus: "cancelled" });
  } catch (error) {
    return errorResponse(error, "Could not cancel the upload");
  }
}
