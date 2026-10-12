import { NextRequest } from "next/server";
import { getVideoProvider } from "@/lib/video/provider";
import { RouteError } from "@/lib/video/errors";
import {
  completeUploadJob,
  createGeneratedVideo,
  failUpload,
  isPreparedMetadata,
  requireActiveAdmin,
  type GeneratedMetadata,
  type ServiceClient,
} from "@/lib/video/publishing";
import { loadJob, reconcileJob, toJobView, viewJob, type JobStatusView } from "@/lib/video/processing";
import { errorResponse, loadOwnUploadJob, noStoreJson } from "@/lib/video/route-helpers";
import { resolveThumbnailUrl } from "@/lib/video/storage";

/** Completing a large upload makes UFOLOAD verify size + sha256; Gemini metadata adds a few seconds. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Finishes a direct upload and registers the video.
 *
 * The browser has already sent every byte to UFOLOAD's upload node. This route:
 *   1. finds the upload session the SERVER created for this admin (`jobId`) —
 *      the browser never supplies a provider file id, embed URL or provider name,
 *      and anything of the sort in the body is ignored;
 *   2. completes the upload through UFOLOAD's authenticated completion endpoint
 *      (size is passed so UFOLOAD verifies it against what was announced);
 *   3. persists UFOLOAD's actual file id and creates the video as private and
 *      `processing`.
 *
 * Publishing is NOT done here. The video becomes public only when UFOLOAD
 * reports the file `ready` (see `lib/video/processing.ts`).
 *
 * The route is safe to repeat: UFOLOAD returns the same file for a repeated
 * `complete`, and a job that already has its video just reports its state.
 */
export async function POST(req: NextRequest) {
  try {
    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      throw new RouteError(415, "Video files can no longer be posted to this route", {
        details: "Start a session at /api/videos/ufoload-session, send the file to the returned uploadUrl in chunks, then POST the jobId here.",
      });
    }

    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new RouteError(400, "Invalid request");

    const job = await loadOwnUploadJob(service, body.jobId, user.id);

    // Already registered (a retry after a lost response): report, never duplicate.
    if (job.video_id && job.provider_file_id) {
      let provider = null;
      try {
        provider = getVideoProvider();
      } catch {
        // A broken provider configuration must not hide a video that is already registered.
      }
      const current = provider ? await reconcileJob({ service, provider, job }) : await viewJob(service, job);
      return noStoreJson(await registrationResponse(service, current, null));
    }
    if (job.status !== "uploading" || !job.provider_upload_id) {
      throw new RouteError(409, `This upload is not waiting to be completed (status: ${job.status}).`, { code: "upload_not_pending" });
    }

    const categoryId = String(body.categoryId ?? "").trim();
    if (!categoryId) throw new RouteError(400, "Choose a category");
    const fileName = String(body.fileName || job.file_name || "uploaded-video").slice(0, 240);
    const thumbnailUrl = resolveThumbnailUrl(service, user.id, body.thumbnailPath ?? null);

    const { data: category } = await service.from("categories").select("id").eq("id", categoryId).maybeSingle();
    if (!category) throw new RouteError(400, "Choose a valid category");

    const provider = getVideoProvider();
    provider.assertEnabled();

    // The provider verifies the announced size; the file id below is UFOLOAD's, not the browser's.
    const completed = await provider.completeDirectUpload(job.provider_upload_id, {
      size: job.file_size && job.file_size > 0 ? job.file_size : undefined,
    });
    const file = completed.file;

    // UFOLOAD deduplicates by content. Re-uploading a file we already host must not create a second public copy.
    const { data: existing } = await service
      .from("videos")
      .select("id, title, slug, status")
      .eq("provider", "ufoload")
      .eq("provider_file_id", file.id)
      .limit(1);
    const duplicateOf = Array.isArray(existing) ? existing[0] : null;
    if (duplicateOf) {
      await failUpload({
        service,
        jobId: job.id,
        message: `UFOLOAD already hosts this exact file (it is attached to “${duplicateOf.title}”), so no second video was created.`,
      });
      throw new RouteError(409, `This exact file was already uploaded as “${duplicateOf.title}”.`, {
        code: "duplicate_upload",
        extra: { videoId: duplicateOf.id, slug: duplicateOf.slug },
      });
    }

    const generated = await createGeneratedVideo({
      service,
      userId: user.id,
      sourceName: fileName,
      categoryId,
      provider: "ufoload",
      thumbnailUrl,
      prepared: isPreparedMetadata(body.metadata) ? body.metadata : null,
    });

    // The video stays `processing` / `private`. Only the file id is recorded now.
    await service.from("videos").update({ provider_file_id: file.id, updated_by: user.id }).eq("id", generated.video.id);
    await completeUploadJob(service, job.id, file.id, {
      videoId: generated.video.id,
      progress: file.progress,
      providerStatus: file.status,
    });

    await service.from("audit_logs").insert({
      actor_id: user.id,
      action: "video_upload_registered",
      target_type: "video",
      target_id: generated.video.id,
      level: "info",
      metadata: {
        provider: "ufoload",
        file_name: fileName,
        file_size: job.file_size,
        provider_file_id: file.id,
        upload_id: job.provider_upload_id,
        duplicate: completed.duplicate,
        metadata_source: generated.metadata.source,
      },
    });

    // A duplicate of an already-processed file can be ready (or failed) right now.
    const registered = (await loadJob(service, job.id)) ?? job;
    const view =
      file.state === "processing"
        ? toJobView(registered, { ...generated.video, status: "processing", provider_file_id: file.id, embed_url: null, created_by: user.id }, new Date().toISOString())
        : await reconcileJob({ service, provider, job: registered, force: true });

    return noStoreJson(await registrationResponse(service, view, generated.metadata));
  } catch (error) {
    return errorResponse(error, "Upload failed");
  }
}

async function registrationResponse(service: ServiceClient, view: JobStatusView, metadata: GeneratedMetadata | null) {
  let slug = view.slug;
  let title = view.title;
  if (view.videoId && (!slug || !title)) {
    const { data } = await service.from("videos").select("slug, title").eq("id", view.videoId).maybeSingle();
    slug = slug ?? data?.slug ?? null;
    title = title ?? data?.title ?? null;
  }
  return {
    videoId: view.videoId,
    jobId: view.jobId,
    status: view.phase,
    progress: view.progress,
    providerStatus: view.providerStatus,
    published: view.published,
    processing: !view.published && view.phase !== "failed" && view.phase !== "cancelled",
    error: view.error,
    warning: view.warning,
    video: { id: view.videoId, slug, title, status: view.published ? "published" : "processing" },
    ...(metadata
      ? {
          metadata,
          metadataSource: metadata.source,
          ...(metadata.warning ? { metadataWarning: metadata.warning } : {}),
        }
      : {}),
  };
}
