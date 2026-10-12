/**
 * Processing-status tracking for UFOLOAD uploads and imports.
 *
 * A video is NEVER public because an upload finished. It becomes public only
 * when UFOLOAD reports its file `ready` and we hold a verified stable embed
 * URL. Everything before that is tracked on an `upload_jobs` row:
 *
 *   direct upload   uploading ──(browser calls /api/videos/upload)──▶ processing ──▶ completed
 *   URL import      uploading (task queued/running) ──▶ processing (file known) ──▶ completed
 *                   └──────────────────────────── failed / cancelled ─────────────┘
 *
 * `reconcileJob` advances ONE job by asking UFOLOAD what it knows. It is
 * called from three places — the admin page's status polling, the admin upload
 * page when it opens, and `POST /api/videos/reconcile` (for an external
 * scheduler). Nothing here waits inside a request: each call does at most a
 * couple of provider lookups and returns, and a job that UFOLOAD is still
 * working on simply stays `processing` until the next call.
 *
 * Failure policy:
 *  - a provider/network problem on a lookup (429, 5xx, timeout, bad key) is NOT
 *    a job failure — the job stays as it was and the problem is reported as a
 *    `warning` for the next attempt;
 *  - a verdict from UFOLOAD (`failed`, import `failed`/`cancelled`, file 404)
 *    or a timeout fails the job with a reason an admin can act on.
 */

import {
  failUpload,
  publishVideo,
  type ProviderVideoDetails,
  type ServiceClient,
} from "@/lib/video/publishing";
import { removeTransitObject } from "@/lib/video/storage";
import { ProviderApiError, VideoProviderConfigError } from "@/lib/video/errors";
import { UFOLOAD_MAX_ACTIVE_IMPORTS } from "@/lib/video/limits";
import { isUfoloadEmbedUrl, type ProviderFile, type VideoProvider } from "@/lib/video/ufoload";

/** A freshly created import may not be in UFOLOAD's list for a moment. */
export const IMPORT_LIST_GRACE_MS = 2 * 60 * 1000;
/** An import that is still queued/running after this long is given up on. */
export const IMPORT_STALL_MS = 6 * 60 * 60 * 1000;
/** A file that is still queued/processing at UFOLOAD after this long is failed. */
export const PROCESSING_TIMEOUT_MS = 48 * 60 * 60 * 1000;
/** UFOLOAD frees an idle direct-upload slot after 15 min; we allow a little more. */
export const UPLOAD_SESSION_IDLE_MS = 20 * 60 * 1000;
/** `done` without a `file_id` for this long means UFOLOAD is not going to give one. */
export const DONE_WITHOUT_FILE_GRACE_MS = 10 * 60 * 1000;
/** Several tabs plus a scheduler must not hammer UFOLOAD for the same job. */
export const MIN_RECHECK_INTERVAL_MS = 2_500;

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface UploadJobRow {
  id: string;
  video_id: string | null;
  file_name: string;
  file_size: number | null;
  provider: string;
  provider_file_id: string | null;
  provider_upload_id: string | null;
  provider_import_task_id: string | null;
  provider_status: string | null;
  status: string;
  progress: number | null;
  error_message: string | null;
  storage_path: string | null;
  created_by: string | null;
  created_at: string;
  last_checked_at: string | null;
}

export interface JobVideoRow {
  id: string;
  slug: string | null;
  title: string | null;
  status: string;
  provider_file_id: string | null;
  embed_url: string | null;
  created_by: string | null;
}

export type JobPhase = "uploading" | "processing" | "ready" | "published" | "failed" | "cancelled";

/** The shape the admin page and the status routes work with. */
export interface JobStatusView {
  jobId: string;
  videoId: string | null;
  slug: string | null;
  title: string | null;
  phase: JobPhase;
  /** Raw `upload_jobs.status`. */
  jobStatus: string;
  /** Raw UFOLOAD status (`queued`, `processing`, `ready`, `import:running`, …). */
  providerStatus: string | null;
  /** 0–100, as reported by UFOLOAD for the current stage. */
  progress: number;
  published: boolean;
  embedUrl: string | null;
  error: string | null;
  /** A problem with the *last check* (provider unreachable…) that did not change the job. */
  warning: string | null;
  checkedAt: string;
}

function phaseOf(job: Pick<UploadJobRow, "status">, video: JobVideoRow | null): JobPhase {
  switch (job.status) {
    case "completed":
      return video?.status === "published" ? "published" : "ready";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "processing":
      return "processing";
    default:
      return "uploading";
  }
}

export function toJobView(job: UploadJobRow, video: JobVideoRow | null, checkedAt: string, warning: string | null = null): JobStatusView {
  const phase = phaseOf(job, video);
  return {
    jobId: job.id,
    videoId: video?.id ?? job.video_id ?? null,
    slug: video?.slug ?? null,
    title: video?.title ?? null,
    phase,
    jobStatus: job.status,
    providerStatus: job.provider_status ?? null,
    progress: Math.max(0, Math.min(100, Math.round(Number(job.progress ?? 0)))),
    published: phase === "published",
    embedUrl: video?.embed_url ?? null,
    error: job.status === "failed" || job.status === "cancelled" ? job.error_message ?? null : null,
    warning,
    checkedAt,
  };
}

export async function loadJob(service: ServiceClient, jobId: string): Promise<UploadJobRow | null> {
  const { data } = await service.from("upload_jobs").select("*").eq("id", jobId).maybeSingle();
  return (data as UploadJobRow | null) ?? null;
}

async function loadVideo(service: ServiceClient, videoId: string | null): Promise<JobVideoRow | null> {
  if (!videoId) return null;
  const { data } = await service
    .from("videos")
    .select("id, slug, title, status, provider_file_id, embed_url, created_by")
    .eq("id", videoId)
    .maybeSingle();
  return (data as JobVideoRow | null) ?? null;
}

/** The current stored state of a job — no provider lookup. */
export async function viewJob(service: ServiceClient, job: UploadJobRow, warning: string | null = null): Promise<JobStatusView> {
  return toJobView(job, await loadVideo(service, job.video_id), new Date().toISOString(), warning);
}

/** Best-effort audit entry — a logging failure must never fail a job. */
async function audit(
  service: ServiceClient,
  entry: { actor: string | null; action: string; videoId: string | null; level?: "info" | "warning" | "error"; metadata: Record<string, unknown> }
) {
  try {
    await service.from("audit_logs").insert({
      actor_id: entry.actor,
      action: entry.action,
      target_type: "video",
      target_id: entry.videoId,
      level: entry.level ?? "info",
      metadata: entry.metadata,
    });
  } catch {
    // ignore
  }
}

/** `HD` from 720p, `4K` from 2160p — the only values `videos.quality` allows. */
export function qualityLabel(height: number | null): "HD" | "4K" | null {
  if (!height || height <= 0) return null;
  if (height >= 2160) return "4K";
  if (height >= 720) return "HD";
  return null;
}

export function providerDetails(file: ProviderFile): ProviderVideoDetails {
  return {
    durationSeconds: file.durationMs != null && file.durationMs > 0 ? Math.max(1, Math.round(file.durationMs / 1000)) : null,
    resolution: file.width && file.height ? `${file.width}x${file.height}` : null,
    quality: qualityLabel(file.maxQuality ?? file.height),
  };
}

/** How many of OUR URL imports UFOLOAD is still downloading — against its limit of 10. */
export async function countActiveImports(service: ServiceClient): Promise<number> {
  const { data } = await service
    .from("upload_jobs")
    .select("id, provider_import_task_id")
    .eq("provider", "ufoload")
    .eq("status", "uploading")
    .limit(500);
  return ((data as Array<{ provider_import_task_id: string | null }> | null) || []).filter((row) => row.provider_import_task_id).length;
}

export function importSlotsFull(active: number): boolean {
  return active >= UFOLOAD_MAX_ACTIVE_IMPORTS;
}

// ---------------------------------------------------------------------------
// reconcileJob
// ---------------------------------------------------------------------------

interface Ctx {
  service: ServiceClient;
  provider: VideoProvider;
  nowMs: number;
  nowIso: string;
}

async function patchJob(ctx: Ctx, job: UploadJobRow, fields: Partial<UploadJobRow>): Promise<UploadJobRow> {
  const update = { ...fields, last_checked_at: ctx.nowIso };
  await ctx.service.from("upload_jobs").update(update).eq("id", job.id);
  return { ...job, ...update };
}

async function failJob(
  ctx: Ctx,
  job: UploadJobRow,
  video: JobVideoRow | null,
  message: string,
  status: "failed" | "cancelled" = "failed"
): Promise<JobStatusView> {
  // A video that is already public is never taken down by a job failure.
  const resetVideo = video && video.status !== "published" ? video.id : null;
  await failUpload({ service: ctx.service, videoId: resetVideo, jobId: job.id, message, status });
  await ctx.service.from("upload_jobs").update({ last_checked_at: ctx.nowIso }).eq("id", job.id);
  await audit(ctx.service, {
    actor: job.created_by,
    action: status === "cancelled" ? "video_processing_cancelled" : "video_processing_failed",
    videoId: video?.id ?? job.video_id,
    level: status === "failed" ? "warning" : "info",
    metadata: { provider: "ufoload", job_id: job.id, reason: message.slice(0, 300) },
  });
  const failedJob: UploadJobRow = { ...job, status, error_message: message, last_checked_at: ctx.nowIso };
  return toJobView(failedJob, video && video.status !== "published" ? { ...video, status: "draft" } : video, ctx.nowIso);
}

/**
 * Advances one job as far as UFOLOAD's current answer allows and returns what
 * the admin UI should show. Never throws for a provider problem.
 */
export async function reconcileJob(args: {
  service: ServiceClient;
  provider: VideoProvider;
  job: UploadJobRow;
  now?: Date;
  /** Skip the provider lookup if this job was checked more recently than this. */
  minIntervalMs?: number;
  /** Ignore `minIntervalMs` — used by an explicit "refresh". */
  force?: boolean;
}): Promise<JobStatusView> {
  const now = args.now ?? new Date();
  const ctx: Ctx = { service: args.service, provider: args.provider, nowMs: now.getTime(), nowIso: now.toISOString() };
  const { job } = args;
  const video = await loadVideo(ctx.service, job.video_id);

  // Finished jobs and non-UFOLOAD rows (legacy Uqload / iframe embeds) have nothing to ask.
  if (job.provider !== "ufoload" || TERMINAL_JOB_STATUSES.has(job.status)) return toJobView(job, video, ctx.nowIso);

  const minInterval = args.minIntervalMs ?? MIN_RECHECK_INTERVAL_MS;
  if (!args.force && job.last_checked_at && ctx.nowMs - Date.parse(job.last_checked_at) < minInterval) {
    return toJobView(job, video, ctx.nowIso);
  }

  try {
    if (job.provider_file_id) return await fileStep(ctx, job, video);
    if (job.provider_import_task_id) return await importStep(ctx, job, video);
    if (job.provider_upload_id) return await uploadSessionStep(ctx, job, video);
    return await failJob(ctx, job, video, "This job has no UFOLOAD reference (no upload session, import task or file id), so it cannot be tracked. Upload the video again.");
  } catch (error) {
    if (error instanceof VideoProviderConfigError) {
      return toJobView(job, video, ctx.nowIso, `Status cannot be refreshed: ${error.details}`);
    }
    if (error instanceof ProviderApiError) {
      await ctx.service.from("upload_jobs").update({ last_checked_at: ctx.nowIso }).eq("id", job.id);
      return toJobView(job, video, ctx.nowIso, error.message);
    }
    throw error;
  }
}

async function importStep(ctx: Ctx, job: UploadJobRow, video: JobVideoRow | null): Promise<JobStatusView> {
  const taskId = job.provider_import_task_id as string;
  const age = ctx.nowMs - Date.parse(job.created_at);
  const task = await ctx.provider.findImport(taskId);

  if (!task) {
    if (age < IMPORT_LIST_GRACE_MS) {
      const waiting = await patchJob(ctx, job, {});
      return toJobView(waiting, video, ctx.nowIso);
    }
    return failJob(
      ctx,
      job,
      video,
      `UFOLOAD no longer lists import task ${taskId} and never reported a file for it — it may have dropped out of UFOLOAD's recent-imports list before the app saw it finish. Look in Files in the UFOLOAD dashboard; if the video is not there, import the link again.`
    );
  }

  if (task.state === "failed") {
    return failJob(ctx, job, video, `UFOLOAD could not import the link: ${task.error ?? "it gave no reason"}. Check that the link is a direct, public video file URL and try again.`);
  }
  if (task.state === "cancelled") {
    return failJob(ctx, job, video, "The import was cancelled at UFOLOAD before it finished.", "cancelled");
  }

  if (task.state === "queued" || task.state === "running") {
    if (age > IMPORT_STALL_MS) {
      await ctx.provider.cancelImport(taskId).catch(() => {});
      return failJob(ctx, job, video, `UFOLOAD was still downloading this link after ${Math.round(IMPORT_STALL_MS / 3_600_000)} hours, so the import was cancelled. Try again or host the file somewhere faster.`);
    }
    const next = await patchJob(ctx, job, { status: "uploading", progress: task.progress, provider_status: `import:${task.status}` });
    return toJobView(next, video, ctx.nowIso);
  }

  // done
  if (!task.fileId) {
    if (age > DONE_WITHOUT_FILE_GRACE_MS) {
      return failJob(ctx, job, video, `UFOLOAD reported import task ${taskId} as done but never returned a file ID. Look in Files in the UFOLOAD dashboard and import the link again if the video is missing.`);
    }
    const waiting = await patchJob(ctx, job, { progress: 100, provider_status: "import:done" });
    return toJobView(waiting, video, ctx.nowIso, "The import finished; waiting for UFOLOAD to report the file.");
  }

  // The task id and the file id are different things: the file id goes in its own column.
  const linked = await patchJob(ctx, job, { provider_file_id: task.fileId, status: "processing", progress: 0, provider_status: "import:done", error_message: null });
  if (video) await ctx.service.from("videos").update({ provider_file_id: task.fileId }).eq("id", video.id);
  return fileStep(ctx, linked, video ? { ...video, provider_file_id: task.fileId } : video);
}

async function uploadSessionStep(ctx: Ctx, job: UploadJobRow, video: JobVideoRow | null): Promise<JobStatusView> {
  const lastActivity = Date.parse(job.last_checked_at ?? job.created_at);
  if (ctx.nowMs - lastActivity <= UPLOAD_SESSION_IDLE_MS) {
    // The browser is expected to be sending bytes and calling the keep-alive.
    return toJobView(job, video, ctx.nowIso);
  }

  const uploadId = job.provider_upload_id as string;
  let fileId: string | null = null;
  try {
    const state = await ctx.provider.getDirectUploadState(uploadId);
    if (state.state === "completed") fileId = state.fileId;
  } catch {
    // The session is unknown or unreachable; release it below.
  }
  if (!fileId) await ctx.provider.cancelDirectUpload(uploadId).catch(() => {});

  return failJob(
    ctx,
    job,
    video,
    fileId
      ? `UFOLOAD finished this upload (file ${fileId}) but the app never registered it — the browser closed before the last step. Find it in Files in the UFOLOAD dashboard, or select the video again.`
      : "The browser stopped sending this upload (no activity for 20 minutes), so the session was released. Select the file again to restart; no video was created.",
    "cancelled"
  );
}

async function fileStep(ctx: Ctx, job: UploadJobRow, video: JobVideoRow | null): Promise<JobStatusView> {
  const fileId = job.provider_file_id as string;
  const age = ctx.nowMs - Date.parse(job.created_at);

  let file: ProviderFile;
  try {
    file = await ctx.provider.getFile(fileId);
  } catch (error) {
    if (error instanceof ProviderApiError && error.status === 404) {
      return failJob(ctx, job, video, `${error.message} Upload the video again.`);
    }
    throw error;
  }

  if (file.state === "failed") {
    return failJob(ctx, job, video, `UFOLOAD could not process the video: ${file.error ?? "encoding failed (no reason given)"}. Upload it again, or try a different file or format.`);
  }

  if (file.state === "processing") {
    if (age > PROCESSING_TIMEOUT_MS) {
      return failJob(ctx, job, video, `UFOLOAD still had not finished processing this file after ${Math.round(PROCESSING_TIMEOUT_MS / 3_600_000)} hours (status "${file.status}"). Check the file in the UFOLOAD dashboard, then upload it again if it is stuck.`);
    }
    const next = await patchJob(ctx, job, { status: "processing", progress: file.progress, provider_status: file.status, error_message: null });
    return toJobView(next, video, ctx.nowIso);
  }

  return finalizeReady(ctx, job, video, file, age);
}

/** UFOLOAD says `ready`: verify the embed URL, then (and only then) publish. */
async function finalizeReady(ctx: Ctx, job: UploadJobRow, video: JobVideoRow | null, file: ProviderFile, age: number): Promise<JobStatusView> {
  if (!video) {
    return failJob(ctx, job, null, "The video record was deleted before UFOLOAD finished processing, so nothing was published.", "cancelled");
  }

  const embedUrl = isUfoloadEmbedUrl(video.embed_url) ? video.embed_url : await ctx.provider.resolveEmbedUrl(file);
  if (!embedUrl) {
    if (age > PROCESSING_TIMEOUT_MS) {
      return failJob(ctx, job, video, "UFOLOAD reports the file ready but never provided a public embed identifier (public_id / filecode), so no verified embed URL exists and the video was not published. Contact UFOLOAD support with the file ID.");
    }
    const waiting = await patchJob(ctx, job, { status: "processing", progress: 99, provider_status: "ready" });
    return toJobView(waiting, video, ctx.nowIso, "UFOLOAD reports the file ready but has not yet provided its public embed identifier; the video stays private until it does.");
  }

  const details = providerDetails(file);
  let current: JobVideoRow = video;

  if (video.status === "processing") {
    const published = await publishVideo({
      service: ctx.service,
      videoId: video.id,
      userId: job.created_by ?? video.created_by,
      providerFileId: file.id,
      // Signed playback links expire; only the stable embed URL is ever stored.
      playableUrl: null,
      embedUrl,
      expectStatus: "processing",
      details,
    });
    if (published) {
      current = { ...video, status: "published", embed_url: embedUrl, provider_file_id: file.id };
      await audit(ctx.service, {
        actor: job.created_by,
        action: "video_published_when_ready",
        videoId: video.id,
        metadata: { provider: "ufoload", job_id: job.id, provider_file_id: file.id, has_embed_url: true },
      });
    } else {
      // Someone else (a parallel reconcile) moved it first — report what is stored now.
      current = (await loadVideo(ctx.service, video.id)) ?? video;
    }
  } else if (video.status !== "published") {
    // An admin changed the video while it processed (draft / rejected / unpublished): keep it
    // exactly as they left it and only record what UFOLOAD reported.
    await ctx.service
      .from("videos")
      .update({
        provider_file_id: file.id,
        embed_url: embedUrl,
        playable_url: null,
        ...(details.durationSeconds ? { duration_seconds: details.durationSeconds } : {}),
      })
      .eq("id", video.id);
    current = { ...video, embed_url: embedUrl, provider_file_id: file.id };
  }

  const done = await patchJob(ctx, job, { status: "completed", progress: 100, provider_status: "ready", error_message: null });

  // The legacy transit copy (retired flow) is no longer needed once the provider has the file.
  if (job.storage_path) {
    await removeTransitObject(ctx.service, job.storage_path);
    await ctx.service.from("upload_jobs").update({ storage_path: null }).eq("id", job.id);
  }
  return toJobView(done, current, ctx.nowIso);
}

// ---------------------------------------------------------------------------
// Background reconciliation
// ---------------------------------------------------------------------------

export interface ReconcileSummary {
  checked: number;
  published: number;
  failed: number;
  cancelled: number;
  stillUploading: number;
  stillProcessing: number;
  /** Unfinished jobs that were skipped because the time budget ran out. */
  deferred: number;
  warnings: string[];
}

/**
 * Reconciles the oldest-checked unfinished UFOLOAD jobs, bounded by `limit`
 * and a wall-clock `budgetMs` so it fits inside a serverless function.
 * Throws {@link VideoProviderConfigError} when the provider is not enabled —
 * the caller (a scheduler) should see that instead of a silent no-op.
 */
export async function reconcileOutstandingJobs(args: {
  service: ServiceClient;
  provider: VideoProvider;
  limit?: number;
  budgetMs?: number;
  now?: () => Date;
  minIntervalMs?: number;
}): Promise<ReconcileSummary> {
  args.provider.assertEnabled();

  const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 25)));
  const budgetMs = Math.max(1000, args.budgetMs ?? 45_000);
  const clock = args.now ?? (() => new Date());
  const startedAt = Date.now();

  const { data } = await args.service
    .from("upload_jobs")
    .select("*")
    .eq("provider", "ufoload")
    .in("status", ["uploading", "processing"])
    .order("created_at", { ascending: true })
    .limit(200);

  // Never-checked jobs first, then the longest-unchecked.
  const jobs = ((data as UploadJobRow[] | null) || [])
    .slice()
    .sort((a, b) => (a.last_checked_at ? Date.parse(a.last_checked_at) : 0) - (b.last_checked_at ? Date.parse(b.last_checked_at) : 0));

  const summary: ReconcileSummary = { checked: 0, published: 0, failed: 0, cancelled: 0, stillUploading: 0, stillProcessing: 0, deferred: 0, warnings: [] };
  const batch = jobs.slice(0, limit);
  summary.deferred = Math.max(0, jobs.length - batch.length);

  for (let index = 0; index < batch.length; index++) {
    if (Date.now() - startedAt > budgetMs) {
      summary.deferred += batch.length - index;
      break;
    }
    const view = await reconcileJob({
      service: args.service,
      provider: args.provider,
      job: batch[index],
      now: clock(),
      minIntervalMs: args.minIntervalMs ?? 0,
    });
    summary.checked += 1;
    if (view.phase === "published") summary.published += 1;
    else if (view.phase === "failed") summary.failed += 1;
    else if (view.phase === "cancelled") summary.cancelled += 1;
    else if (view.phase === "uploading") summary.stillUploading += 1;
    else summary.stillProcessing += 1;
    if (view.warning && summary.warnings.length < 5) summary.warnings.push(view.warning);
  }
  return summary;
}
