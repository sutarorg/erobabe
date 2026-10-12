import { NextRequest } from "next/server";
import { getVideoProvider } from "@/lib/video/provider";
import { ProviderApiError, RouteError } from "@/lib/video/errors";
import { UFOLOAD_MAX_ACTIVE_IMPORTS } from "@/lib/video/limits";
import {
  assertPublicHttpUrl,
  createGeneratedVideo,
  createUploadJob,
  requireActiveAdmin,
  sourceNameFromUrl,
} from "@/lib/video/publishing";
import { countActiveImports, importSlotsFull } from "@/lib/video/processing";
import { errorResponse, noStoreJson } from "@/lib/video/route-helpers";
import { resolveThumbnailUrl } from "@/lib/video/storage";
import { normalizeRemoteEntries, splitUrlEntries } from "@/lib/video/entries";
import type { ImportTask } from "@/lib/video/ufoload";

const MAX_URLS_PER_REQUEST = 20;
/** What the admin page is told to wait before retrying when UFOLOAD's import slots are full. */
const SLOTS_FULL_RETRY_SECONDS = 30;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Starts asynchronous URL imports at UFOLOAD.
 *
 * "Import" means UFOLOAD's own servers download the link — this request only
 * *starts* the task (`POST /api/v1/files/import` answers 202) and returns. It
 * never waits for the download or the encoding. Each started import is a
 * `processing` video plus an `upload_jobs` row holding the import TASK id (in
 * `provider_import_task_id`, never in `provider_file_id`); `lib/video/processing.ts`
 * follows the task to a file and the file to `ready`, and only then publishes.
 *
 * Order matters: the import is started at UFOLOAD first. UFOLOAD allows 10
 * active imports at a time, so when its slots are full nothing has been
 * written to our database yet and the entry is reported as retryable.
 *
 * The SSRF guard (`assertPublicHttpUrl`) runs for every link before anything is
 * queued; UFOLOAD applies its own internal-network blocking as well.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new RouteError(400, "Invalid request");

    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) throw new RouteError(400, "Choose a category");

    // `normalizeRemoteEntries` silently keeps only the first 20; count what was actually sent.
    const requested = Array.isArray(body.entries) ? body.entries.length : splitUrlEntries(body.urls || "").length;
    if (requested > MAX_URLS_PER_REQUEST) throw new RouteError(400, `Upload up to ${MAX_URLS_PER_REQUEST} remote URLs at a time`);

    const rawEntries = normalizeRemoteEntries(body);
    const entries: Array<{ url: string; thumbnailPath: string | null }> = [];
    const seen = new Set<string>();
    for (const entry of rawEntries) {
      let url: string;
      try {
        url = assertPublicHttpUrl(entry.url, "Remote video URL");
      } catch (error) {
        throw new RouteError(400, error instanceof Error ? error.message : "Remote video URL is not valid");
      }
      if (seen.has(url)) continue;
      seen.add(url);
      entries.push({ url, thumbnailPath: entry.thumbnailPath });
    }
    if (!entries.length) throw new RouteError(400, "Enter at least one remote video URL");
    if (entries.length > MAX_URLS_PER_REQUEST) throw new RouteError(400, `Upload up to ${MAX_URLS_PER_REQUEST} remote URLs at a time`);

    const { data: category } = await service.from("categories").select("id").eq("id", categoryId).maybeSingle();
    if (!category) throw new RouteError(400, "Choose a valid category");

    const provider = getVideoProvider();
    provider.assertEnabled();

    const thumbnailByPath = new Map<string, string | null>();
    const results: Array<Record<string, unknown>> = [];
    let activeImports = await countActiveImports(service);
    let slotsFull = false;
    let retryAfterSeconds = SLOTS_FULL_RETRY_SECONDS;

    const slotsFullResult = (remoteUrl: string) => ({
      remoteUrl,
      status: "failed",
      code: "import_slots_full",
      retryable: true,
      retryAfterSeconds,
      error: `UFOLOAD runs at most ${UFOLOAD_MAX_ACTIVE_IMPORTS} URL imports at a time and they are all busy. This link was not started — it will be retried when a slot frees up.`,
    });

    for (const entry of entries) {
      const remoteUrl = entry.url;
      try {
        if (slotsFull || importSlotsFull(activeImports)) {
          slotsFull = true;
          results.push(slotsFullResult(remoteUrl));
          continue;
        }

        let thumbnailUrl: string | null = null;
        if (entry.thumbnailPath) {
          if (!thumbnailByPath.has(entry.thumbnailPath)) {
            thumbnailByPath.set(entry.thumbnailPath, resolveThumbnailUrl(service, user.id, entry.thumbnailPath));
          }
          thumbnailUrl = thumbnailByPath.get(entry.thumbnailPath) || null;
        }
        const sourceName = sourceNameFromUrl(remoteUrl);

        // 1. Start the task at UFOLOAD. A full queue leaves nothing behind in our database.
        let task: ImportTask;
        try {
          task = await provider.startImport({ url: remoteUrl });
        } catch (error) {
          if (error instanceof ProviderApiError && error.code === "too_many_imports") {
            slotsFull = true;
            retryAfterSeconds = error.retryAfterSeconds ?? SLOTS_FULL_RETRY_SECONDS;
            results.push(slotsFullResult(remoteUrl));
            continue;
          }
          throw error;
        }

        // 2. Record it. If that fails, do not leave a download running that nothing tracks.
        let generated: Awaited<ReturnType<typeof createGeneratedVideo>> | null = null;
        let job: Awaited<ReturnType<typeof createUploadJob>>;
        try {
          generated = await createGeneratedVideo({
            service,
            userId: user.id,
            sourceName,
            categoryId,
            provider: "ufoload",
            thumbnailUrl,
          });
          job = await createUploadJob({
            service,
            videoId: generated.video.id,
            userId: user.id,
            fileName: sourceName,
            provider: "ufoload",
            status: "uploading",
            providerImportTaskId: task.id,
            providerStatus: `import:${task.status}`,
          });
        } catch (error) {
          await provider.cancelImport(task.id).catch(() => {});
          if (generated) await service.from("videos").delete().eq("id", generated.video.id);
          throw error;
        }
        activeImports += 1;

        await service.from("audit_logs").insert({
          actor_id: user.id,
          action: "video_import_started",
          target_type: "video",
          target_id: generated.video.id,
          level: "info",
          metadata: {
            provider: "ufoload",
            host: new URL(remoteUrl).hostname,
            import_task_id: task.id,
            has_custom_thumbnail: Boolean(thumbnailUrl),
          },
        });

        results.push({
          remoteUrl,
          videoId: generated.video.id,
          jobId: job.id,
          importTaskId: task.id,
          title: generated.video.title,
          slug: generated.video.slug,
          status: "processing",
          providerStatus: `import:${task.status}`,
          progress: task.progress,
          metadataSource: generated.metadata.source,
          ...(generated.metadata.warning ? { metadataWarning: generated.metadata.warning } : {}),
        });
      } catch (error) {
        const known = error instanceof ProviderApiError;
        results.push({
          remoteUrl,
          status: "failed",
          error: error instanceof Error && error.message ? error.message : "Unable to start the import",
          ...(known ? { code: error.code, retryable: error.retryable } : {}),
        });
      }
    }

    const accepted = results.filter((result) => result.status === "processing").length;
    const allSlotsFull = accepted === 0 && results.length > 0 && results.every((result) => result.code === "import_slots_full");
    const status = accepted ? (accepted === results.length ? 202 : 207) : allSlotsFull ? 429 : 422;
    // When nothing was started, also surface the first reason at the top level so a client
    // that only reads `error` / `code` / `retryable` (see `readApiResponse`) can act on it.
    const first = accepted === 0 ? results[0] : null;
    return noStoreJson(
      {
        results,
        succeeded: accepted,
        failed: results.length - accepted,
        ...(first
          ? {
              error: first.error,
              ...(first.code ? { code: first.code } : {}),
              ...(typeof first.retryable === "boolean" ? { retryable: first.retryable } : {}),
              ...(typeof first.retryAfterSeconds === "number" ? { retryAfterSeconds: first.retryAfterSeconds } : {}),
            }
          : {}),
      },
      { status, headers: allSlotsFull ? { "Retry-After": String(retryAfterSeconds) } : {} }
    );
  } catch (error) {
    return errorResponse(error, "URL upload failed");
  }
}
