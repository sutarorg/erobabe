/**
 * Streamtape upload / import lifecycle.
 *
 * Server-side heart of the migration: it owns the transitions between "bytes
 * are moving", "the provider accepted the transfer", "Streamtape is encoding"
 * and "the video may go public". Two rules are absolute:
 *
 *   1. The provider file id never comes from the browser as an accepted fact.
 *      A candidate parsed from the relayed node response must be confirmed
 *      server-side with `/file/info` (name + size), or resolved through an
 *      unambiguous `/file/listfolder` match. Unresolved uploads stay
 *      `processing` / private until the bounded grace window expires.
 *   2. "Uploaded" and "queued" are never "published". Only a provider response
 *      that says the file is converted makes a row public.
 *
 * Bytes never pass through this module: the browser POSTs multipart data to
 * the streaming relay (`relay/streamtape-relay.mjs`) using the URL minted by
 * `startStreamtapeUpload`.
 */

import { randomUUID } from "crypto";
import {
  attachProviderFile,
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
  StreamtapeError,
  convertProgressPercent,
  fileIdFromWatchUrl,
  isStreamtapeIdentifier,
  mapFileInfoReadiness,
  mapRemoteTaskState,
  parseNodeUploadResponse,
  redactSecrets,
  selectUnclaimedFile,
  streamtapeEmbedUrl,
  type StreamtapeFileInfo,
  type StreamtapeRemoteTask,
} from "@/lib/video/streamtape-protocol";
import type { FileInfo } from "@/lib/video/provider";
import { streamtapeMaxUploadBytes, type StreamtapeProvider } from "@/lib/video/streamtape";

/**
 * How long a video may wait for Streamtape to register a finished transfer
 * (or list an import task) before the row is failed with an actionable reason.
 */
export const RESOLUTION_GRACE_MS = 6 * 60 * 60 * 1000;

/** Bounded server-side attempts when confirming a candidate file id. */
export const CONFIRM_ATTEMPTS = 3;
export const CONFIRM_DELAY_MS = 1_500;

export interface StreamtapeUploadSession {
  jobId: string;
  /**
   * Opaque upload session id (`upload_jobs.provider_upload_id`). Completion
   * requests are validated against this row — never against a browser-supplied
   * provider id.
   */
  uploadId: string;
  /** Relay address the browser POSTs the multipart body to (`{relay}/upload/{token}`). */
  uploadUrl: string;
  expiresAt: string | null;
  /** App-level ceiling for this transfer (bytes), null when unlimited. */
  maxBytes: number | null;
  fileName: string;
  fileSize: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Step 1: ask Streamtape for an upload node URL, wrap it in a signed relay
 * token, and persist the session so a later completion can be validated.
 *
 * The API credentials are never part of the response — the browser only ever
 * sees the relay address with its one-shot token.
 */
export async function startStreamtapeUpload({
  service,
  userId,
  provider,
  fileName,
  fileSize,
}: {
  service: ServiceClient;
  userId: string;
  provider: StreamtapeProvider;
  fileName: string;
  fileSize: number;
}): Promise<StreamtapeUploadSession> {
  const relay = provider.assertRelayConfigured();
  const { signRelayToken } = await import("@/lib/video/relay-token");
  const secret = (process.env.STREAMTAPE_RELAY_SECRET || "").trim();

  const upload = await provider.getUploadUrl();

  // Token expiry: the provider's own validity, clamped to a sane ceiling so a
  // queued admin tab cannot hold a usable upload capability indefinitely.
  const providerExpiry = upload.validUntil ? Date.parse(String(upload.validUntil).replace(" ", "T")) : Number.NaN;
  const ceiling = Date.now() + 30 * 60 * 1000;
  const exp = Math.min(Number.isFinite(providerExpiry) ? providerExpiry : ceiling, ceiling);

  const sessionId = randomUUID();
  const job = await createUploadJob({
    service,
    videoId: null,
    userId,
    fileName,
    fileSize,
    provider: "streamtape",
    providerUploadId: sessionId,
  });

  const token = signRelayToken({ u: upload.url, s: sessionId, exp }, secret);

  return {
    jobId: job.id,
    uploadId: sessionId,
    uploadUrl: `${relay}/upload/${token}`,
    expiresAt: Number.isFinite(exp) ? new Date(exp).toISOString() : null,
    maxBytes: streamtapeMaxUploadBytes(),
    fileName,
    fileSize,
  };
}

export interface StreamtapeCompletionResult {
  video: GeneratedVideo;
  metadata: GeneratedMetadata;
  jobId: string;
  providerFileId: string | null;
  embedUrl: string | null;
  playableUrl: string | null;
  readiness: "ready" | "processing" | "failed";
  providerStatus: string;
  progress: number | null;
  error: string | null;
  note: string | null;
}

/**
 * Steps 3–4: after the browser's multipart POST finished, confirm which file
 * Streamtape created, create the video row, and keep it private until the
 * provider reports the file converted.
 */
export async function completeStreamtapeUpload({
  service,
  userId,
  provider,
  uploadId,
  categoryId,
  fileName,
  fileSize,
  thumbnailUrl,
  prepared,
  nodeResponse,
}: {
  service: ServiceClient;
  userId: string;
  provider: StreamtapeProvider;
  uploadId: string;
  categoryId: string;
  fileName: string;
  fileSize?: number | null;
  thumbnailUrl?: string | null;
  prepared?: GeneratedMetadata | null;
  /** Raw response text the relay passed back from the upload node. */
  nodeResponse?: string | null;
}): Promise<StreamtapeCompletionResult> {
  const job = await findUploadJobForSession(service, userId, uploadId, "streamtape");
  if (!job) {
    throw new StreamtapeError(
      "This upload session does not belong to your account, or it was already completed. Start the upload again from this page.",
      { status: 404, code: "unknown_upload_session" }
    );
  }
  if (job.video_id) {
    throw new StreamtapeError("This upload was already completed — open its video row instead of completing it again.", {
      status: 409,
      code: "duplicate_completion",
    });
  }

  const generated = await createGeneratedVideo({
    service,
    userId,
    sourceName: fileName,
    categoryId,
    provider: "streamtape",
    thumbnailUrl,
    prepared: isPreparedMetadata(prepared) ? prepared : null,
  });
  await updateUploadJob(service, job.id, { video_id: generated.video.id });

  const resolved = await resolveProviderFileId({
    service,
    provider,
    fileName,
    fileSize: fileSize ?? job.file_size ?? null,
    nodeResponse,
  });

  if (!resolved) {
    // Bytes are at the provider but the id is not provable yet. The row stays
    // private and reconciliation keeps trying within the grace window — it is
    // never marked live on assumption.
    await updateUploadJob(service, job.id, {
      provider_status: "awaiting_registration",
      status: "processing",
      error_message: null,
    });
    return {
      video: generated.video,
      metadata: generated.metadata,
      jobId: job.id,
      providerFileId: null,
      embedUrl: null,
      playableUrl: null,
      readiness: "processing",
      providerStatus: "awaiting_registration",
      progress: null,
      error: null,
      note: "The upload finished, but Streamtape has not listed the file yet — the row stays private and re-checks automatically.",
    };
  }

  const outcome = await persistProviderFile({
    service,
    userId,
    provider,
    videoId: generated.video.id,
    jobId: job.id,
    fileId: resolved,
    fileName,
    fileSize: fileSize ?? job.file_size ?? null,
    thumbnailUrl,
  });

  return {
    video: generated.video,
    metadata: generated.metadata,
    jobId: job.id,
    providerFileId: resolved,
    embedUrl: outcome.embedUrl,
    playableUrl: null,
    readiness: outcome.readiness,
    providerStatus: outcome.providerStatus,
    progress: outcome.progress,
    error: outcome.error,
    note: outcome.note,
  };
}

// --------------------------------------------------------------- id resolution

interface ClaimQuery {
  notClaimed: (linkId: string) => boolean;
}

/** Ids already written onto video rows — they must never be re-claimed. */
async function claimedIds(service: ServiceClient, candidates: string[]): Promise<Set<string>> {
  if (!candidates.length) return new Set();
  const { data } = await service.from("videos").select("provider_file_id").in("provider_file_id", candidates);
  return new Set((data || []).map((row: any) => row.provider_file_id).filter(Boolean));
}

async function buildClaimQuery(service: ServiceClient, files: Array<{ linkId: string | null }>): Promise<ClaimQuery> {
  const ids = Array.from(new Set(files.map((file) => file.linkId).filter((id): id is string => Boolean(id))));
  const claimed = await claimedIds(service, ids);
  return { notClaimed: (linkId) => !claimed.has(linkId) };
}

function nameAndSizeMatch(info: StreamtapeFileInfo, fileName: string, fileSize: number | null): boolean {
  const expectedSize = fileSize != null && fileSize > 0 ? Number(fileSize) : null;
  const sizeKnown = info.sizeBytes != null && expectedSize !== null;
  const nameKnown = Boolean(info.name) && Boolean(fileName);

  if (sizeKnown && info.sizeBytes !== expectedSize) return false;
  if (nameKnown && String(info.name).trim().toLowerCase() !== String(fileName).trim().toLowerCase()) return false;
  // At least one attribute must have actually confirmed the identity.
  if (!sizeKnown && !nameKnown) return false;
  return sizeKnown || nameKnown;
}

/**
 * Resolves the file id for a finished transfer — without trusting the browser.
 *
 * 1. Candidate parsed from the node's pass-through response → confirmed
 *    server-side with `/file/info` (name + size must match the job).
 * 2. Fallback: unambiguous `/file/listfolder` match (exact name, size when
 *    known, inside a freshness window, not already claimed by another row).
 * 3. Bounded retries cover the provider's registration lag. `null` means
 *    "unproven" — callers keep the row private.
 */
export async function resolveProviderFileId({
  service,
  provider,
  fileName,
  fileSize,
  nodeResponse,
  attempts = CONFIRM_ATTEMPTS,
  delayMs = CONFIRM_DELAY_MS,
}: {
  service: ServiceClient;
  provider: StreamtapeProvider;
  fileName: string;
  fileSize?: number | null;
  nodeResponse?: string | null;
  attempts?: number;
  delayMs?: number;
}): Promise<string | null> {
  const candidate = parseNodeUploadResponse(nodeResponse || "").fileId;

  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    if (attempt > 0) await sleep(delayMs);

    if (candidate && isStreamtapeIdentifier(candidate)) {
      try {
        const info = await provider.fetchFileInfo(candidate);
        if (info && nameAndSizeMatch(info, fileName, fileSize ?? null)) return candidate;
      } catch (error: unknown) {
        // 404/registration lag → fall through to the folder listing.
        if (!(error instanceof StreamtapeError) || (error.status !== 404 && error.status !== 400)) throw error;
      }
    }

    try {
      const files = await provider.listFolder();
      const claim = await buildClaimQuery(service, files);
      const match = selectUnclaimedFile(files, {
        name: fileName,
        sizeBytes: fileSize ?? null,
        notClaimed: claim.notClaimed,
      });
      if (match?.linkId) return match.linkId;
    } catch (error: unknown) {
      // A listing failure must not abort the whole completion — the next
      // attempt (or the status reconciliation) can still resolve it.
      console.warn(`[streamtape] folder reconciliation failed: ${redactSecrets(error instanceof Error ? error.message : "unknown error", [
        process.env.STREAMTAPE_API_KEY,
        process.env.STREAMTAPE_LOGIN,
      ])}`);
    }
  }

  return null;
}

// --------------------------------------------------------------- persistence

interface PersistOutcome {
  embedUrl: string;
  readiness: "ready" | "processing" | "failed";
  providerStatus: string;
  progress: number | null;
  error: string | null;
  note: string | null;
}

/**
 * Writes the confirmed provider identifiers onto the video row and applies the
 * provider's current state. Only a converted file may become public.
 */
async function persistProviderFile({
  service,
  userId,
  provider,
  videoId,
  jobId,
  fileId,
  fileName,
  fileSize,
  thumbnailUrl,
}: {
  service: ServiceClient;
  userId: string;
  provider: StreamtapeProvider;
  videoId: string;
  jobId: string;
  fileId: string;
  fileName: string;
  fileSize: number | null;
  thumbnailUrl?: string | null;
}): Promise<PersistOutcome> {
  const embedUrl = provider.getEmbedUrl(fileId);
  let info: StreamtapeFileInfo | null = null;
  try {
    info = await provider.fetchFileInfo(fileId);
  } catch (error: unknown) {
    if (error instanceof StreamtapeError && error.status === 404) info = null;
    else throw error;
  }

  const readiness = info ? mapFileInfoReadiness(info) : "processing";

  await attachProviderFile({
    service,
    videoId,
    userId,
    provider: "streamtape",
    providerFileId: fileId,
    // Streamtape exposes no stable direct-media URL (downloads are ticketed
    // and expiring) — the embed page is the documented playable address.
    embedUrl,
    playableUrl: null,
    thumbnailUrl,
  });
  await updateUploadJob(service, jobId, { provider_file_id: fileId, provider_status: info ? (readiness === "ready" ? "converted" : "processing") : "uploaded" });

  if (readiness === "ready") {
    const splash = (thumbnailUrl ? null : await provider.getSplashUrl(fileId)) || null;
    await markVideoReady({
      service,
      videoId,
      userId,
      embedUrl,
      playableUrl: null,
      thumbnailUrl: splash,
    });
    await updateUploadJob(service, jobId, { status: "completed", progress: 100, provider_status: "converted", error_message: null });
    // Provider-side title is cosmetic; a failure never blocks a publish.
    await provider.renameFile(fileId, fileName);
    return { embedUrl, readiness, providerStatus: "converted", progress: 100, error: null, note: "Streamtape confirmed this video is ready." };
  }

  if (readiness === "failed") {
    const message =
      info?.entryStatus === 451
        ? "Streamtape restricted this file for legal reasons (451). Review the content and Streamtape's copyright policy."
        : "Streamtape could not process this file. Check the source file and upload it again.";
    await markVideoFailed({ service, videoId, jobId, message });
    return { embedUrl, readiness, providerStatus: "failed", progress: null, error: message, note: message };
  }

  await updateUploadJob(service, jobId, { status: "processing", error_message: null });
  return {
    embedUrl,
    readiness,
    providerStatus: "uploaded",
    progress: null,
    error: null,
    note: "Uploaded — Streamtape is still converting this video. The row stays private until it is ready.",
  };
}

// --------------------------------------------------------------- remote imports

export interface StreamtapeImportStart {
  video: GeneratedVideo;
  metadata: GeneratedMetadata;
  jobId: string;
  importId: string;
  providerStatus: string;
}

/**
 * `remotedl/add` — the provider answers with a *task*, so the video row stays
 * private and the task id is stored separately from the (still unknown)
 * provider file id. A queued task is never reported as published.
 */
export async function startStreamtapeImport({
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
  provider: StreamtapeProvider;
  categoryId: string;
  remoteUrl: string;
  name: string;
  thumbnailUrl?: string | null;
}): Promise<StreamtapeImportStart> {
  const generated = await createGeneratedVideo({
    service,
    userId,
    sourceName: name,
    categoryId,
    provider: "streamtape",
    thumbnailUrl,
  });
  const job = await createUploadJob({
    service,
    videoId: generated.video.id,
    userId,
    fileName: name,
    provider: "streamtape",
  });

  let task: { id: string };
  try {
    task = await provider.addRemoteUpload(remoteUrl, { name });
  } catch (error: unknown) {
    await markVideoFailed({
      service,
      videoId: generated.video.id,
      jobId: job.id,
      message: error instanceof Error ? error.message : "Streamtape did not accept the remote upload",
    });
    throw error;
  }

  // The task id is deliberately *not* written into provider_file_id.
  await updateUploadJob(service, job.id, {
    provider_import_id: task.id,
    provider_status: "new",
    progress: 0,
    status: "processing",
  });

  return {
    video: generated.video,
    metadata: generated.metadata,
    jobId: job.id,
    importId: task.id,
    providerStatus: "new",
  };
}

// ------------------------------------------------------------ reconciliation

export type ReconciliationOutcome =
  | { state: "processing"; providerInfo?: FileInfo; note: string }
  | { state: "ready"; embedUrl: string; playableUrl: string | null; providerInfo: FileInfo }
  | { state: "failed"; error: string; providerInfo?: FileInfo };

/**
 * Reconciles one stored record with Streamtape.
 *
 * Handles both shapes of in-flight work:
 *   - a direct upload whose file id is confirmed or still registering, and
 *   - a remote import whose task has not produced a file yet
 *     (`provider_import_id`).
 *
 * Called by `/api/videos/status`, so an interrupted admin session — or a row
 * that simply stayed `processing` — can be brought up to date without a
 * background worker. Legacy rows (`ufoload`, `uqload`, `embed`, …) never reach
 * this function: the status route answers them as stored history.
 */
export async function reconcileStreamtapeRecord({
  service,
  userId,
  provider,
  video,
  job,
}: {
  service: ServiceClient;
  userId: string;
  provider: StreamtapeProvider;
  video: { id: string; provider_file_id?: string | null; thumbnail_url?: string | null };
  job: {
    id: string;
    provider_import_id?: string | null;
    provider_file_id?: string | null;
    file_name?: string | null;
    file_size?: number | null;
    created_at?: string | null;
  } | null;
}): Promise<ReconciliationOutcome> {
  if (!video.provider_file_id && job?.provider_import_id) {
    return reconcileImport({ service, userId, provider, video, job });
  }

  let fileId = video.provider_file_id || job?.provider_file_id || null;

  if (!fileId) {
    // Completion could not confirm the id. Keep trying inside the grace
    // window; after it, fail with an actionable reason (never publish).
    const startedAt = Date.parse(job?.created_at || "");
    const waited = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
    if (!job?.file_name) {
      return { state: "processing", note: "Waiting for the upload session to be completed." };
    }
    const resolved = await resolveProviderFileId({
      service,
      provider,
      fileName: job.file_name,
      fileSize: job.file_size ?? null,
      attempts: 1,
      delayMs: 0,
    });
    if (!resolved) {
      if (waited > RESOLUTION_GRACE_MS) {
        const message =
          "Streamtape never registered this upload. The transfer may have been interrupted — start the upload again.";
        await markVideoFailed({ service, videoId: video.id, jobId: job.id, message });
        return { state: "failed", error: message };
      }
      return { state: "processing", note: "Streamtape has not listed the uploaded file yet." };
    }
    fileId = resolved;
    await attachProviderFile({
      service,
      videoId: video.id,
      userId,
      provider: "streamtape",
      providerFileId: resolved,
      embedUrl: provider.getEmbedUrl(resolved),
      playableUrl: null,
      thumbnailUrl: video.thumbnail_url || null,
    });
    await updateUploadJob(service, job.id, { provider_file_id: resolved });
  }

  return inspectFileState({ service, userId, provider, videoId: video.id, jobId: job?.id ?? "", fileId, thumbnailUrl: video.thumbnail_url || null });
}

async function inspectFileState({
  service,
  userId,
  provider,
  videoId,
  jobId,
  fileId,
  thumbnailUrl,
}: {
  service: ServiceClient;
  userId: string;
  provider: StreamtapeProvider;
  videoId: string;
  jobId: string;
  fileId: string;
  thumbnailUrl: string | null;
}): Promise<ReconciliationOutcome> {
  let info: StreamtapeFileInfo | null = null;
  try {
    info = await provider.fetchFileInfo(fileId);
  } catch (error: unknown) {
    if (!(error instanceof StreamtapeError) || (error.status !== 404 && error.status !== 400)) throw error;
    info = null;
  }

  if (info && mapFileInfoReadiness(info) === "ready") {
    const embedUrl = provider.getEmbedUrl(fileId);
    const splash = (thumbnailUrl ? null : await provider.getSplashUrl(fileId)) || null;
    await markVideoReady({ service, videoId, userId, embedUrl, playableUrl: null, thumbnailUrl: splash });
    if (jobId) await updateUploadJob(service, jobId, { status: "completed", progress: 100, provider_status: "converted", error_message: null });
    return { state: "ready", embedUrl, playableUrl: null, providerInfo: toFileInfo(info, fileId) };
  }

  if (info && mapFileInfoReadiness(info) === "failed") {
    const message =
      info.entryStatus === 451
        ? "Streamtape restricted this file for legal reasons (451). Review the content and Streamtape's copyright policy."
        : "Streamtape could not process this file.";
    await markVideoFailed({ service, videoId, jobId, message });
    return { state: "failed", error: message, providerInfo: toFileInfo(info, fileId) };
  }

  // Not converted (or not listed yet): consult the conversion queues for a
  // definitive failure or live progress.
  const [running, failed] = await Promise.all([provider.listRunningConverts(), provider.listFailedConverts()]);
  const matches = (entry: { linkId: string | null; name: string | null }) =>
    (entry.linkId && entry.linkId === fileId) || false;

  const failedEntry = failed.find(matches);
  if (failedEntry) {
    const message = `Streamtape could not convert this video (provider status "${failedEntry.status || "error"}"). Check the source file and upload it again.`;
    await markVideoFailed({ service, videoId, jobId, message });
    return { state: "failed", error: message };
  }

  const runningEntry = running.find(matches);
  if (runningEntry) {
    const percent = convertProgressPercent(runningEntry.progress);
    if (percent !== null) {
      await recordProviderProgress(service, videoId, percent);
      if (jobId) await updateUploadJob(service, jobId, { provider_status: runningEntry.status || "converting", progress: percent });
    }
    return {
      state: "processing",
      providerInfo: info ? toFileInfo(info, fileId) : undefined,
      note: `Streamtape is converting this video${percent !== null ? ` (${percent}%)` : ""}…`,
    };
  }

  if (!info) {
    // Absent from both info and the queues: keep the grace window.
    return { state: "processing", providerInfo: undefined, note: "Streamtape has not listed this file yet." };
  }

  return {
    state: "processing",
    providerInfo: toFileInfo(info, fileId),
    note: "Streamtape is still processing this video.",
  };
}

async function reconcileImport({
  service,
  userId,
  provider,
  video,
  job,
}: {
  service: ServiceClient;
  userId: string;
  provider: StreamtapeProvider;
  video: { id: string; provider_file_id?: string | null; thumbnail_url?: string | null };
  job: { id: string; provider_import_id?: string | null; file_name?: string | null; created_at?: string | null };
}): Promise<ReconciliationOutcome> {
  const importId = job.provider_import_id || "";
  let task: StreamtapeRemoteTask | null = null;
  try {
    task = await provider.getRemoteStatus(importId);
  } catch (error: unknown) {
    if (!(error instanceof StreamtapeError) || (error.status !== 404 && error.status !== 400)) throw error;
    task = null;
  }

  const startedAt = Date.parse(job.created_at || "");
  const waited = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;

  if (!task) {
    if (waited > RESOLUTION_GRACE_MS) {
      const message = "Streamtape no longer lists this remote upload, and no file was created. Check the source URL and start the import again.";
      await markVideoFailed({ service, videoId: video.id, jobId: job.id, message });
      return { state: "failed", error: message };
    }
    return { state: "processing", note: "Streamtape has not listed the remote upload yet." };
  }

  const state = mapRemoteTaskState(task);
  if (state === "failed") {
    const message = `Streamtape could not download this URL (status "${task.status || "failed"}").`;
    await markVideoFailed({ service, videoId: video.id, jobId: job.id, message });
    return { state: "failed", error: message };
  }

  if (state === "processing") {
    const percent =
      task.bytesTotal && task.bytesTotal > 0 && task.bytesLoaded !== null
        ? Math.max(0, Math.min(99, Math.round((task.bytesLoaded / task.bytesTotal) * 100)))
        : null;
    await updateUploadJob(service, job.id, {
      provider_status: task.status || "remote",
      progress: percent ?? 0,
      error_message: null,
    });
    return { state: "processing", note: "Streamtape is downloading the remote file…" };
  }

  // Done → resolve the created file id (watch URL, else folder reconciliation),
  // then continue with the file's own conversion state.
  let fileId = fileIdFromWatchUrl(task.url);
  if (!fileId && typeof task.extid === "string" && isStreamtapeIdentifier(task.extid)) fileId = task.extid;
  if (!fileId) {
    const resolved = await resolveProviderFileId({
      service,
      provider,
      fileName: job.file_name || "",
      fileSize: null,
      attempts: 1,
      delayMs: 0,
    });
    fileId = resolved;
  }
  if (!fileId) {
    if (waited > RESOLUTION_GRACE_MS) {
      const message = "The remote download finished but Streamtape never produced a usable file id. Start the import again.";
      await markVideoFailed({ service, videoId: video.id, jobId: job.id, message });
      return { state: "failed", error: message };
    }
    return { state: "processing", note: "Remote download finished — waiting for Streamtape to register the file…" };
  }

  await attachProviderFile({
    service,
    videoId: video.id,
    userId,
    provider: "streamtape",
    providerFileId: fileId,
    embedUrl: provider.getEmbedUrl(fileId),
    playableUrl: null,
    thumbnailUrl: video.thumbnail_url || null,
  });
  await updateUploadJob(service, job.id, { provider_file_id: fileId });

  return inspectFileState({
    service,
    userId,
    provider,
    videoId: video.id,
    jobId: job.id,
    fileId,
    thumbnailUrl: video.thumbnail_url || null,
  });
}

/** The provider-agnostic view returned alongside every status response. */
export function toFileInfo(info: StreamtapeFileInfo, fallbackId?: string): FileInfo {
  const readiness = mapFileInfoReadiness(info);
  return {
    fileId: info.id || fallbackId || "",
    title: info.name ?? undefined,
    status: readiness === "ready" ? 200 : readiness === "failed" ? 500 : 202,
    canPlay: readiness === "ready",
    fileSize: info.sizeBytes ?? undefined,
    providerStatus: readiness === "ready" ? "converted" : readiness === "failed" ? "failed" : "processing",
    errorMessage: info.entryStatus === 451 ? "Unavailable for legal reasons (451)." : undefined,
  };
}

/** Stable embed address re-exported for callers that only import the flow. */
export { streamtapeEmbedUrl };
