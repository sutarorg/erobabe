/**
 * UFOLOAD upload / import lifecycle.
 *
 * This is the server-side heart of the migration: it owns the transitions
 * between "bytes are moving", "the provider has the file", "the provider is
 * encoding" and "the video may go public". Nothing here trusts the browser for
 * a provider identifier — the provider file id always comes back from UFOLOAD,
 * and upload sessions are looked up by the row the server itself created.
 */

import {
  attachProviderFile,
  completeUploadJob,
  createGeneratedVideo,
  createUploadJob,
  findUploadJobForSession,
  isPreparedMetadata,
  markVideoFailed,
  markVideoReady,
  recordProviderProgress,
  updateUploadJob,
  type GeneratedMetadata,
  type GeneratedVideo,
  type ServiceClient,
} from "@/lib/video/publishing";
import {
  UfoloadError,
  mapUfoloadStatus,
  redactSecret,
  uploadPercent,
  ufoloadPlayerIdentifier,
  type UfoloadFile,
  type UfoloadImportTask,
} from "@/lib/video/ufoload-protocol";
import type { FileInfo } from "@/lib/video/provider";
import type { UfoloadProvider } from "@/lib/video/ufoload";

/** How long a record may wait for its import task to be listed before it fails. */
export const IMPORT_TRACKING_GRACE_MS = 6 * 60 * 60 * 1000;

export interface UfoloadUploadSession {
  jobId: string;
  uploadId: string;
  /** The complete node URL from UFOLOAD — the browser must use it verbatim. */
  url: string;
  /** Upload-scoped grant header value (not the API key). */
  authorization: string;
  chunkSize: number;
  maxBytes: number | null;
  expiresAt: string | null;
  fileName: string;
  fileSize: number;
}

/**
 * Step 1: ask UFOLOAD for a direct-upload grant and persist the session so a
 * later completion request can be validated against it.
 */
export async function startUfoloadUpload({
  service,
  userId,
  provider,
  fileName,
  fileSize,
  mimeType,
}: {
  service: ServiceClient;
  userId: string;
  provider: UfoloadProvider;
  fileName: string;
  fileSize: number;
  mimeType?: string;
}): Promise<UfoloadUploadSession> {
  const grant = await provider.initDirectUpload({ fileName, fileSize, mimeType });

  if (grant.maxBytes !== null && fileSize > grant.maxBytes) {
    // Free the slot we just reserved — this upload can never succeed.
    await provider.cancelDirectUpload(grant.uploadId).catch(() => false);
    throw new UfoloadError(
      `This file is larger than the UFOLOAD upload limit for the account (${grant.maxBytes} bytes). Upload a smaller file or upgrade the plan.`,
      { status: 413, code: "plan_file_too_large" }
    );
  }

  const job = await createUploadJob({
    service,
    videoId: null,
    userId,
    fileName,
    fileSize,
    provider: "ufoload",
    providerUploadId: grant.uploadId,
  });

  return {
    jobId: job.id,
    uploadId: grant.uploadId,
    url: grant.url,
    authorization: grant.authorization,
    chunkSize: grant.chunkSize,
    maxBytes: grant.maxBytes,
    expiresAt: grant.expiresAt,
    fileName,
    fileSize,
  };
}

export interface UfoloadCompletionResult {
  video: GeneratedVideo;
  metadata: GeneratedMetadata;
  jobId: string;
  providerFileId: string;
  providerPublicId: string | null;
  embedUrl: string;
  playableUrl: string;
  providerStatus: UfoloadFile["status"];
  readiness: "ready" | "processing" | "failed";
  progress: number | null;
  error: string | null;
}

/**
 * Steps 3–4: complete the upload server-side, create the video row, and keep
 * it private until the provider confirms the file is ready to play.
 */
export async function completeUfoloadUpload({
  service,
  userId,
  provider,
  uploadId,
  categoryId,
  fileName,
  fileSize,
  thumbnailUrl,
  prepared,
}: {
  service: ServiceClient;
  userId: string;
  provider: UfoloadProvider;
  uploadId: string;
  categoryId: string;
  fileName: string;
  fileSize?: number | null;
  thumbnailUrl?: string | null;
  prepared?: GeneratedMetadata | null;
}): Promise<UfoloadCompletionResult> {
  const job = await findUploadJobForSession(service, userId, uploadId);
  if (!job) {
    throw new UfoloadError(
      "This upload session does not belong to your account, or it was already completed. Start the upload again from this page.",
      { status: 404, code: "unknown_upload_session" }
    );
  }

  const generated = await createGeneratedVideo({
    service,
    userId,
    sourceName: fileName,
    categoryId,
    provider: "ufoload",
    thumbnailUrl,
    prepared: isPreparedMetadata(prepared) ? prepared : null,
  });

  // Link the job to the video it is producing. The job was created before the
  // video existed (the browser is still transferring bytes at that point), and
  // without this the job row could only ever be found by its upload session —
  // so a status poll that starts from a videoId would leave it stale.
  await updateUploadJob(service, job.id, { video_id: generated.video.id });

  let file: UfoloadFile;
  try {
    file = await provider.completeDirectUpload(uploadId, {
      size: Number.isFinite(Number(fileSize)) && Number(fileSize) > 0 ? Number(fileSize) : job.file_size || undefined,
    });
  } catch (error) {
    await markVideoFailed({
      service,
      videoId: generated.video.id,
      jobId: job.id,
      message: error instanceof Error ? error.message : "UFOLOAD did not accept the completed upload",
    });
    throw error;
  }

  const outcome = await persistProviderFile({
    service,
    userId,
    provider,
    videoId: generated.video.id,
    jobId: job.id,
    file,
    thumbnailUrl,
  });

  // The provider-side name is cosmetic; a failure must never unpublish a video.
  await provider
    .renameFile(file.id, generated.metadata.title)
    .catch((error: unknown) => {
      console.warn(`[ufoload] could not rename file: ${redactSecret((error as Error)?.message || "unknown error")}`);
      return false;
    });

  return {
    video: generated.video,
    metadata: generated.metadata,
    jobId: job.id,
    providerFileId: file.id,
    providerPublicId: file.publicId,
    embedUrl: outcome.embedUrl,
    playableUrl: outcome.playableUrl,
    providerStatus: file.status,
    readiness: outcome.readiness,
    progress: file.progress,
    error: file.error,
  };
}

interface PersistOutcome {
  embedUrl: string;
  playableUrl: string;
  readiness: "ready" | "processing" | "failed";
}

/**
 * Writes the provider identifiers onto the video row and applies the provider's
 * current state. Only `ready` makes the video public.
 */
async function persistProviderFile({
  service,
  userId,
  provider,
  videoId,
  jobId,
  file,
  thumbnailUrl,
}: {
  service: ServiceClient;
  userId: string;
  provider: UfoloadProvider;
  videoId: string;
  jobId: string;
  file: UfoloadFile;
  thumbnailUrl?: string | null;
}): Promise<PersistOutcome> {
  const identifier = ufoloadPlayerIdentifier(file);
  const embedUrl = provider.getEmbedUrl(identifier);
  const playableUrl = provider.getPlayableUrl(identifier);

  await attachProviderFile({
    service,
    videoId,
    userId,
    provider: "ufoload",
    providerFileId: file.id,
    providerPublicId: file.publicId,
    embedUrl,
    playableUrl,
    thumbnailUrl,
    durationSeconds: file.durationSeconds,
    progress: file.progress,
  });

  const readiness = mapUfoloadStatus(file.status);
  await updateUploadJob(service, jobId, {
    provider_file_id: file.id,
    provider_status: file.status,
    progress: file.status === "ready" ? 100 : uploadPercent(file.progress ?? 0, 100),
    status: readiness === "failed" ? "failed" : readiness === "ready" ? "completed" : "processing",
    error_message: readiness === "failed" ? (file.error || "UFOLOAD could not process this file") : null,
  });

  if (readiness === "ready") {
    await markVideoReady({
      service,
      videoId,
      userId,
      embedUrl,
      playableUrl,
      thumbnailUrl: thumbnailUrl || file.posterUrl,
      durationSeconds: file.durationSeconds,
    });
  } else if (readiness === "failed") {
    await markVideoFailed({
      service,
      videoId,
      jobId,
      message: file.error || "UFOLOAD could not process this file. Check the source file and upload it again.",
    });
  }

  return { embedUrl, playableUrl, readiness };
}

// ------------------------------------------------------------------ imports

export interface UfoloadImportStart {
  video: GeneratedVideo;
  metadata: GeneratedMetadata;
  jobId: string;
  importId: string;
  providerStatus: UfoloadImportTask["status"];
}

/**
 * `POST /files/import` — the provider answers with a *task*, so the video row
 * stays private and the task id is stored separately from the (still unknown)
 * provider file id.
 */
export async function startUfoloadImport({
  service,
  userId,
  provider,
  categoryId,
  remoteUrl,
  name,
  thumbnailUrl,
}: {
  service: ServiceClient;
  userId: string;
  provider: UfoloadProvider;
  categoryId: string;
  remoteUrl: string;
  name: string;
  thumbnailUrl?: string | null;
}): Promise<UfoloadImportStart> {
  const generated = await createGeneratedVideo({
    service,
    userId,
    sourceName: name,
    categoryId,
    provider: "ufoload",
    thumbnailUrl,
  });
  const job = await createUploadJob({
    service,
    videoId: generated.video.id,
    userId,
    fileName: name,
    provider: "ufoload",
  });

  let task: UfoloadImportTask;
  try {
    task = await provider.createImport({ url: remoteUrl, name });
  } catch (error) {
    await markVideoFailed({
      service,
      videoId: generated.video.id,
      jobId: job.id,
      message: error instanceof Error ? error.message : "UFOLOAD did not accept the import",
    });
    throw error;
  }

  // The task id is deliberately *not* written into provider_file_id.
  await updateUploadJob(service, job.id, {
    provider_import_id: task.id,
    provider_status: task.status,
    progress: task.progress ?? 0,
    status: "processing",
  });

  return {
    video: generated.video,
    metadata: generated.metadata,
    jobId: job.id,
    importId: task.id,
    providerStatus: task.status,
  };
}

export type ReconciliationOutcome =
  | { state: "processing"; providerInfo?: FileInfo; note: string }
  | { state: "ready"; embedUrl: string; playableUrl: string; providerInfo: FileInfo }
  | { state: "failed"; error: string; providerInfo?: FileInfo };

/**
 * Reconciles one stored record with the provider.
 *
 * Handles both shapes of in-flight work:
 *   - a direct upload that is still encoding (`provider_file_id` present), and
 *   - a URL import whose task has not produced a file yet (`provider_import_id`).
 *
 * Called by `/api/videos/status`, so an interrupted admin session — or a
 * record that simply stayed `processing` — can always be brought up to date
 * without a background worker.
 */
export async function reconcileUfoloadRecord({
  service,
  userId,
  provider,
  video,
  job,
}: {
  service: ServiceClient;
  userId: string;
  provider: UfoloadProvider;
  video: { id: string; provider_file_id?: string | null; provider_public_id?: string | null; thumbnail_url?: string | null };
  job: { id: string; provider_import_id?: string | null; provider_file_id?: string | null; created_at?: string | null } | null;
}): Promise<ReconciliationOutcome> {
  if (!video.provider_file_id && job?.provider_import_id) {
    const task = await provider.findImport(job.provider_import_id);

    if (!task) {
      const startedAt = Date.parse(job.created_at || "");
      const waited = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
      if (waited > IMPORT_TRACKING_GRACE_MS) {
        const message =
          "UFOLOAD no longer lists this import task, and no file was created. Check the source URL and start the import again.";
        await markVideoFailed({ service, videoId: video.id, jobId: job.id, message });
        return { state: "failed", error: message };
      }
      return { state: "processing", note: "UFOLOAD has not listed the import task yet." };
    }

    if (task.status === "failed" || task.status === "cancelled") {
      const message =
        task.error ||
        (task.status === "cancelled" ? "The UFOLOAD import was cancelled." : "UFOLOAD could not download this URL.");
      await markVideoFailed({ service, videoId: video.id, jobId: job.id, message });
      return { state: "failed", error: message };
    }

    if (task.status !== "done" || !task.fileId) {
      await updateUploadJob(service, job.id, {
        provider_status: task.status,
        progress: task.progress ?? 0,
        error_message: null,
      });
      return {
        state: "processing",
        note:
          task.status === "queued"
            ? "Queued at UFOLOAD — waiting for the download to start."
            : "UFOLOAD is downloading the file.",
      };
    }

    // The import finished: continue with the created file's own processing.
    //
    // Only the `File` object is read here. The signed `links` set carries an
    // `expires_at` (hours, not years), so neither its playback address nor its
    // poster may be written to the database — the stable poster is `file.poster`.
    const file = await provider.getFile(task.fileId);
    await updateUploadJob(service, job.id, { provider_status: file.status });
    const outcome = await persistProviderFile({
      service,
      userId,
      provider,
      videoId: video.id,
      jobId: job.id,
      file,
      thumbnailUrl: video.thumbnail_url || null,
    });
    return outcomeToResult(outcome, file);
  }

  const fileId = video.provider_file_id || job?.provider_file_id;
  if (!fileId) return { state: "processing", note: "Waiting for an upload session to be completed." };

  const file = await provider.getFile(fileId);
  if (job?.id) await updateUploadJob(service, job.id, { provider_status: file.status });

  const readiness = mapUfoloadStatus(file.status);
  if (readiness === "processing") {
    await recordProviderProgress(service, video.id, file.progress);
    return { state: "processing", providerInfo: toFileInfo(file), note: "UFOLOAD is still processing this video." };
  }

  const outcome = await persistProviderFile({
    service,
    userId,
    provider,
    videoId: video.id,
    jobId: job?.id ?? "",
    file,
    thumbnailUrl: video.thumbnail_url,
  });
  return outcomeToResult(outcome, file);
}

function outcomeToResult(outcome: PersistOutcome, file: UfoloadFile): ReconciliationOutcome {
  if (outcome.readiness === "ready") {
    return { state: "ready", embedUrl: outcome.embedUrl, playableUrl: outcome.playableUrl, providerInfo: toFileInfo(file) };
  }
  if (outcome.readiness === "failed") {
    return { state: "failed", error: file.error || "UFOLOAD could not process this file.", providerInfo: toFileInfo(file) };
  }
  return { state: "processing", providerInfo: toFileInfo(file), note: "UFOLOAD is still processing this video." };
}

/** The provider-agnostic view returned alongside every status response. */
export function toFileInfo(file: UfoloadFile): FileInfo {
  return {
    fileId: file.id,
    title: file.name ?? undefined,
    status: file.status === "ready" ? 200 : file.status === "failed" ? 500 : 202,
    canPlay: file.status === "ready",
    thumbnailUrl: file.posterUrl ?? undefined,
    durationSeconds: file.durationSeconds ?? undefined,
    fileSize: file.sizeBytes ?? undefined,
    views: file.views ?? undefined,
    providerStatus: file.status,
    progress: file.progress ?? undefined,
    errorMessage: file.error ?? undefined,
    publicId: file.publicId ?? undefined,
  };
}
