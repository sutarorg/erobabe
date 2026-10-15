"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UploadCloud, CheckCircle2, LoaderCircle, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { validateVideo, type UploadPolicy } from "@/lib/video/bunny-validation";
import { generateCategoryFallbackMetadata } from "@/lib/metadata/suggestion";
import { localVideoThumbnail } from "@/src/utils/localVideoThumbnail";
import {
  uploadBunnyVideo,
  type BunnyUploadTarget,
} from "@/src/utils/bunnyUpload";
import { uploadWithProgress, UploadAbortedError } from "@/src/utils/uploadFile";

type Phase =
  | "Queued"
  | "Preparing"
  | "Uploading"
  | "Encoding"
  | "Confirming"
  | "Completed"
  | "Failed"
  | "Cancelled";

type Item = {
  id: string;
  file: File;
  title: string;
  description?: string;
  userEditedTitle?: boolean;
  aiGeneratedForCategory?: string;
  phase: Phase;
  percent: number;
  thumbnail?: Blob | null;
  preview?: string;
  duration?: number;
  warning?: string;
  error?: string;
  transferred?: boolean;
  thumbnailPath?: string;
  slug?: string;
  categoryId?: string;
};

const PARALLEL_UPLOADS = 4;

/** Requests per metadata draft before the browser composes one itself. */
const METADATA_REQUEST_ATTEMPTS = 3;
/** Longest a rate-limited draft waits before asking again. */
const MAX_METADATA_RETRY_WAIT_MS = 30_000;

type MetadataResponse = {
  suggestion?: { title?: unknown; description?: unknown };
  source?: unknown;
  warning?: unknown;
  error?: unknown;
};

/**
 * How long to wait before asking the metadata route again, or `null` when a
 * retry cannot help (an auth or request problem, or a reply without a draft).
 */
function metadataRetryDelay(
  response: Response | null,
  data: MetadataResponse | null,
  attempt: number,
): number | null {
  if (!response) return 1000 * (attempt + 1);
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    return Math.min(
      MAX_METADATA_RETRY_WAIT_MS,
      Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 5000,
    );
  }
  // 5xx, a platform timeout page, or a body that is not JSON at all.
  if (response.status >= 500 || (response.ok && data === null)) return 1500 * (attempt + 1);
  return null;
}

function describeMetadataFailure(response: Response | null, data: MetadataResponse | null): string {
  if (!response) return "the metadata service could not be reached.";
  if (response.status === 429) return "too many metadata requests in a row.";
  if (response.status === 401 || response.status === 403)
    return "the admin session was not accepted. Sign in again.";
  if (response.ok) return "the metadata service returned no draft.";
  const message = typeof data?.error === "string" ? data.error.trim().slice(0, 160) : "";
  return `the metadata service failed (${message || `HTTP ${response.status}`}).`;
}

/** Shown only when no AI copy could be had at all; a repaired AI draft carries no notice. */
function aiUnavailableNotice(reason: string): string {
  const detail = reason.trim();
  return `AI copy unavailable: ${detail}${/[.!?]$/.test(detail) ? "" : "."} This title was drafted from the category vocabulary instead. Review it, or press Generate explicit title to try the AI again.`;
}

/** Another queue entry already owns the server session for the same source file. */
class DuplicateQueueEntryError extends Error {}

/** A route failure carrying the machine-readable code a client may act on. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function json<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) {
    const after = response.headers.get("retry-after");
    throw new ApiError(
      `${result.error || "Request failed."}${after ? ` Retry after ${after} seconds.` : ""}`,
      typeof result.code === "string" ? result.code : undefined,
    );
  }
  return result;
}

export default function UploadPage() {
  const [policy, setPolicy] = useState<UploadPolicy | null>(null);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [categoryId, setCategoryId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const current = useRef(items);
  current.current = items;
  const controllers = useRef(new Map<string, AbortController>());
  const encodingWatchers = useRef(new Map<string, AbortController>());
  const usedTitles = useRef(new Set<string>());
  // AI copy runs one-at-a-time so concurrent upload workers share the latest
  // generated title in their near-duplicate exclusion list.
  const metadataQueue = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);
  const busy = useRef(false);
  const decodeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const generatingIds = useRef(new Set<string>());

  function prepareThumbnail(file: File) {
    const result = decodeQueue.current.then(() =>
      alive.current
        ? localVideoThumbnail(file, policy?.visionRanking === true)
        : { thumbnail: null },
    );
    decodeQueue.current = result.catch(() => undefined);
    return result;
  }

  const patch = (id: string, value: Partial<Item>) => {
    current.current = current.current.map((i) =>
      i.id === id ? { ...i, ...value } : i,
    );
    if (alive.current) setItems(current.current);
  };

  /** Re-keys a queue entry to the server session resumed for the same file. */
  const adoptSession = (from: string, to: string) => {
    current.current = current.current.map((i) =>
      i.id === from ? { ...i, id: to } : i,
    );
    const controller = controllers.current.get(from);
    if (controller) {
      controllers.current.delete(from);
      controllers.current.set(to, controller);
    }
    if (alive.current) setItems(current.current);
  };

  const load = useCallback(async () => {
    try {
      const result = await json<{
        policy: UploadPolicy | null;
        configurationError: string | null;
      }>("/api/videos/bunny/sessions");
      if (!alive.current) return;
      setPolicy(
        result.policy
          ? { ...result.policy, concurrency: PARALLEL_UPLOADS }
          : null,
      );
      setError(result.configurationError || "");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const transferControllers = controllers.current;
    const activeEncodingWatchers = encodingWatchers.current;
    void load();
    createClient()
      .from("categories")
      .select("id, label")
      .order("label")
      .then(({ data }) => {
        if (alive.current) setCategories(data || []);
      });
    return () => {
      alive.current = false;
      transferControllers.forEach((c) => c.abort());
      activeEncodingWatchers.forEach((c) => c.abort());
      current.current.forEach((i) => {
        if (i.preview) URL.revokeObjectURL(i.preview);
      });
    };
  }, [load]);

  /**
   * Draft listing copy for every queue entry the moment its category is known,
   * so an admin who picks files first and a category second never sees a
   * filename in a title field. Entries whose title was edited by hand are left
   * alone, and `generatingIds` keeps one in-flight request per entry.
   */
  useEffect(() => {
    if (!categoryId) return;
    for (const item of current.current) {
      if (
        item.categoryId ||
        item.userEditedTitle ||
        item.aiGeneratedForCategory === categoryId ||
        ["Completed", "Encoding"].includes(item.phase) ||
        generatingIds.current.has(item.id)
      )
        continue;
      generatingIds.current.add(item.id);
      void generateAiMetadataForCategory(categoryId)
        .then((meta) => {
          if (!alive.current || !current.current.some((i) => i.id === item.id))
            return;
          patch(item.id, {
            title: meta.title,
            description: meta.description,
            aiGeneratedForCategory: categoryId,
            warning: meta.warning,
          });
        })
        .finally(() => generatingIds.current.delete(item.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the queue is read
    // from `current.current`; re-running on every item patch would restart work.
  }, [categoryId]);

  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  /**
   * One draft in the site's publishing voice (blunt adult copy by default).
   * The route repairs length slips in the model's reply rather than rejecting
   * it, and answers with a category draft in the same voice only when the model
   * is unconfigured, out of credits, or declines adults-only copy. A route that
   * is unreachable, rate limited, or failing is asked again before the browser
   * composes a draft itself, so a queue entry never keeps its filename.
   */
  function generateAiMetadataForCategory(
    targetCategoryId: string,
  ): Promise<{ title: string; description: string; warning?: string }> {
    const generate = async () => {
      const categoryLabel =
        categories.find((c) => c.id === targetCategoryId)?.label || "Mature";
      // Add titles only after the preceding request completes: upload workers
      // are parallel, but their category-only metadata generation is serialized.
      const existingList = Array.from(usedTitles.current).slice(-100);
      let failure = describeMetadataFailure(null, null);
      for (
        let attempt = 0;
        attempt < METADATA_REQUEST_ATTEMPTS && alive.current;
        attempt += 1
      ) {
        let response: Response | null = null;
        let data: MetadataResponse | null = null;
        try {
          response = await fetch("/api/metadata/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Deliberately omit filename, default title, and tags. Category drives
            // generation; the title list is used only to prevent repetition.
            body: JSON.stringify({
              category: categoryLabel,
              existingTitles: existingList,
            }),
            cache: "no-store",
          });
          data = await response.json().catch(() => null);
        } catch {
          // An unreachable route is retried below, then composed in the browser.
        }
        if (response?.ok && data?.suggestion?.title) {
          const nextTitle = String(data.suggestion.title).trim();
          const nextDescription = String(data.suggestion.description || "").trim();
          usedTitles.current.add(nextTitle);
          return {
            title: nextTitle,
            description: nextDescription,
            ...(data.source === "offline"
              ? { warning: aiUnavailableNotice(String(data.warning || "the model was not used.")) }
              : {}),
          };
        }
        failure = describeMetadataFailure(response, data);
        const delay = metadataRetryDelay(response, data, attempt);
        if (delay === null || attempt === METADATA_REQUEST_ATTEMPTS - 1) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const fallback = generateCategoryFallbackMetadata(
        "",
        categoryLabel,
        existingList,
      );
      usedTitles.current.add(fallback.title);
      return {
        title: fallback.title,
        description: fallback.description,
        warning: aiUnavailableNotice(failure),
      };
    };

    const queued = metadataQueue.current.then(generate, generate);
    metadataQueue.current = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async function add(files: File[]) {
    if (!policy) return;
    const accepted: Item[] = [],
      rejected: string[] = [];
    for (const file of files) {
      const invalid = validateVideo(file, policy);
      if (invalid) {
        rejected.push(`${file.name}: ${invalid}`);
        continue;
      }
      if (
        [...current.current, ...accepted].some(
          (i) =>
            i.file.name === file.name &&
            i.file.size === file.size &&
            i.file.lastModified === file.lastModified,
        )
      )
        continue;
      const id = crypto.randomUUID();
      accepted.push({
        id,
        file,
        title:
          file.name
            .replace(/\.[^.]+$/, "")
            .replace(/[_-]+/g, " ")
            .slice(0, 240) || "Untitled",
        phase: "Preparing",
        percent: 0,
      });
    }
    current.current = [...current.current, ...accepted];
    setItems(current.current);
    setError(rejected.join("\n"));
    // Sequential decoding keeps browser memory bounded independently of upload concurrency.
    for (const item of accepted) {
      const result = await prepareThumbnail(item.file);
      if (!alive.current || !current.current.some((i) => i.id === item.id))
        continue;
      if (result.thumbnail && item.preview) URL.revokeObjectURL(item.preview);
      patch(item.id, {
        ...result,
        preview: result.thumbnail
          ? URL.createObjectURL(result.thumbnail)
          : undefined,
        phase: result.thumbnail || item.thumbnailPath ? "Queued" : "Failed",
        error:
          result.thumbnail || item.thumbnailPath
            ? undefined
            : "Thumbnail generation failed. Retry with the same browser-decodable source file.",
      });
      // Draft the listing copy while the admin is still picking files, so the
      // queue shows a publishable title instead of `IMG_2041_final_v2`. Upload
      // start regenerates only when the category changed in the meantime.
      if (categoryId && !item.userEditedTitle) {
        const meta = await generateAiMetadataForCategory(categoryId);
        if (!alive.current || !current.current.some((i) => i.id === item.id))
          continue;
        patch(item.id, {
          title: meta.title,
          description: meta.description,
          aiGeneratedForCategory: categoryId,
          warning: meta.warning,
        });
      }
    }
  }

  async function watchEncoding(itemId: string) {
    if (encodingWatchers.current.has(itemId)) return;
    const watcher = new AbortController();
    encodingWatchers.current.set(itemId, watcher);
    try {
      while (alive.current && !watcher.signal.aborted) {
        try {
          const response = await fetch("/api/videos/bunny/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: itemId }),
            cache: "no-store",
            signal: watcher.signal,
          });
          const result = await response.json();
          if (!response.ok && !(response.status === 409 && result.failed))
            throw new Error(result.error || "Encoding status check failed.");
          if (result.failed) {
            patch(itemId, {
              phase: "Failed",
              error: result.error || "Bunny could not encode this video.",
              warning: undefined,
            });
            return;
          }
          if (!result.processing && result.slug) {
            patch(itemId, {
              phase: "Completed",
              percent: 100,
              slug: result.slug,
              warning: undefined,
            });
            return;
          }
          patch(itemId, {
            phase: "Encoding",
            percent: 100,
            slug: result.slug,
            warning: `Bunny ${result.providerStatus || "processing"} · ${Math.floor(result.progress || 0)}% encoding`,
          });
        } catch {
          if (watcher.signal.aborted) return;
          patch(itemId, {
            phase: "Encoding",
            warning:
              "Encoding status check is temporarily unavailable; retrying in the background.",
          });
        }
        await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const abort = () => {
            clearTimeout(timer);
            resolve();
          };
          timer = setTimeout(() => {
            watcher.signal.removeEventListener("abort", abort);
            resolve();
          }, 15000);
          watcher.signal.addEventListener("abort", abort, { once: true });
        });
      }
    } finally {
      encodingWatchers.current.delete(itemId);
    }
  }

  async function upload(item: Item) {
    // Re-selected files can resume an earlier server session (after a reload,
    // failure or cancellation); every call after reservation uses its ID.
    let sessionId = item.id;
    let latest = current.current.find((i) => i.id === sessionId)!;
    const controller = new AbortController();
    controllers.current.set(sessionId, controller);
    try {
      if (!latest.thumbnail && !latest.thumbnailPath) {
        patch(sessionId, { phase: "Preparing", error: undefined });
        const generated = await prepareThumbnail(item.file);
        patch(sessionId, {
          ...generated,
          preview: generated.thumbnail
            ? URL.createObjectURL(generated.thumbnail)
            : undefined,
        });
        latest = current.current.find((i) => i.id === sessionId)!;
        if (!latest.thumbnail)
          throw new Error(
            "Thumbnail generation failed. Retry with a browser-decodable source; video will not be published without a real frame thumbnail.",
          );
      }
      if (controller.signal.aborted) throw new UploadAbortedError();
      if (!latest.transferred) {
        const targetCategoryId = latest.categoryId || categoryId;
        patch(sessionId, {
          phase: "Preparing",
          error: undefined,
          categoryId: targetCategoryId,
        });
        latest = current.current.find((i) => i.id === sessionId)!;

        if (
          !latest.userEditedTitle &&
          latest.aiGeneratedForCategory !== targetCategoryId
        ) {
          const aiMeta = await generateAiMetadataForCategory(targetCategoryId);
          if (controller.signal.aborted) throw new UploadAbortedError();
          patch(sessionId, {
            title: aiMeta.title,
            description: aiMeta.description,
            aiGeneratedForCategory: targetCategoryId,
            warning: aiMeta.warning,
          });
          latest = current.current.find((i) => i.id === sessionId)!;
        }

        const session = await json<BunnyUploadTarget>(
          "/api/videos/bunny/sessions",
          {
            sessionId,
            title: latest.title,
            ...(latest.description ? { description: latest.description } : {}),
            originalName: item.file.name,
            mimeType: item.file.type,
            sizeBytes: item.file.size,
            categoryId: latest.categoryId,
            ...(item.duration === undefined
              ? {}
              : { durationSeconds: Math.floor(item.duration) }),
          },
        );
        if (session.warning && alive.current) setNotice(session.warning);
        if (session.sessionId && session.sessionId !== sessionId) {
          if (current.current.some((i) => i.id === session.sessionId))
            throw new DuplicateQueueEntryError(
              "This file is already being uploaded by another entry in this queue.",
            );
          adoptSession(sessionId, session.sessionId);
          sessionId = session.sessionId;
        }
        if (session.completed) {
          patch(sessionId, {
            phase: "Completed",
            slug: session.slug,
            percent: 100,
            ...(session.alreadyUploaded
              ? {
                  warning:
                    "This file was already uploaded earlier, so no duplicate was created.",
                }
              : {}),
          });
          return;
        }
        if (controller.signal.aborted) throw new UploadAbortedError();
        if (!session.transferred) {
          patch(sessionId, { phase: "Uploading", percent: 0 });
          await uploadBunnyVideo(session, item.file, {
            title: latest.title,
            signal: controller.signal,
            onProgress: (p) => patch(sessionId, { percent: p.percent }),
          });
        }
        patch(sessionId, { transferred: true });
      }
      // Cancellation is disabled after transfer: persistence must not be abandoned accidentally.
      patch(sessionId, { phase: "Confirming", error: undefined });
      latest = current.current.find((i) => i.id === sessionId)!;
      if (latest.thumbnail && !latest.thumbnailPath) {
        try {
          const target = await json<{ uploadUrl: string; storagePath: string }>(
            "/api/videos/storage-token",
            {
              kind: "thumbnail",
              fileName: "frame.jpg",
              fileSize: latest.thumbnail.size,
              mimeType: "image/jpeg",
            },
          );
          await uploadWithProgress(target.uploadUrl, latest.thumbnail, {
            contentType: "image/jpeg",
            headers: { "x-upsert": "false" },
          });
          patch(sessionId, { thumbnailPath: target.storagePath });
        } catch {
          throw new Error(
            "Video transferred, but thumbnail storage failed. Retry to store the thumbnail and confirm without re-uploading the video.",
          );
        }
      }
      latest = current.current.find((i) => i.id === sessionId)!;
      if (controller.signal.aborted) throw new UploadAbortedError();
      const done = await json<{
        slug?: string;
        processing?: boolean;
        providerStatus?: string;
        progress?: number;
      }>("/api/videos/bunny/confirm", {
        sessionId,
        thumbnailPath: latest.thumbnailPath || null,
      });
      if (!done.processing && done.slug) {
        patch(sessionId, {
          phase: "Completed",
          percent: 100,
          slug: done.slug,
          warning: undefined,
        });
        return;
      }
      patch(sessionId, {
        phase: "Encoding",
        percent: 100,
        slug: done.slug,
        warning: `Bunny ${done.providerStatus || "processing"} · ${Math.floor(done.progress || 0)}% encoding`,
      });
      // Keep encoding checks separate from the upload worker so the next file
      // starts immediately instead of waiting for Bunny's transcoder.
      void watchEncoding(sessionId);
    } catch (e) {
      // Its catalog video was deleted, so a retry must transfer a new video:
      // drop the transferred state and the server re-arms a fresh session for
      // the same file (no rename needed).
      const videoDeleted = e instanceof ApiError && e.code === "video_deleted";
      if (
        /Thumbnail (storage failed|generation required)/i.test(
          (e as Error).message,
        )
      )
        patch(sessionId, { thumbnailPath: undefined });
      patch(sessionId, {
        phase: e instanceof UploadAbortedError ? "Cancelled" : "Failed",
        error: (e as Error).message,
        ...(videoDeleted ? { transferred: false, slug: undefined } : {}),
      });
      // The shared session belongs to the other queue entry; leave it untouched.
      if (e instanceof DuplicateQueueEntryError) return;
      // That session is completed server-side, so a lifecycle report cannot apply.
      if (videoDeleted) return;
      await fetch("/api/videos/bunny/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          reason:
            e instanceof UploadAbortedError
              ? "user_cancelled"
              : /thumbnail/i.test((e as Error).message)
                ? "thumbnail_failed"
                : "upload_failed",
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    } finally {
      controllers.current.delete(sessionId);
    }
  }

  async function start(ids?: string[]) {
    if (!policy || !categoryId || busy.current) return;
    const queue = current.current.filter(
      (i) =>
        (ids
          ? ids.includes(i.id)
          : ["Queued", "Failed", "Cancelled"].includes(i.phase)) &&
        i.title.trim(),
    );
    busy.current = true;
    setRunning(true);
    let index = 0;
    const concurrency = Math.min(PARALLEL_UPLOADS, policy.concurrency || PARALLEL_UPLOADS, queue.length);
    const worker = async () => {
      while (index < queue.length && alive.current)
        await upload(queue[index++]);
    };
    await Promise.all(
      Array.from({ length: concurrency }, worker),
    );
    busy.current = false;
    if (alive.current) {
      setRunning(false);
    }
  }

  const completed = items.filter((i) => i.phase === "Completed").length;
  const failed = items.filter((i) => i.phase === "Failed").length;

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Upload videos</h1>
          <p className="mt-2 text-sm text-ink-3">
            Local files → Bunny Stream. AI title and description drafts use the
            selected category only, not the filename or default title. Generate
            and review the copy before starting when possible; videos publish
            automatically after encoding, and no search ranking is guaranteed.
          </p>
        </div>
        <Link href="/admin/videos" className="text-sm text-accent">
          Video library
        </Link>
      </div>
      {loading && (
        <p role="status" className="mb-4 text-ink-3">
          Loading upload configuration…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 whitespace-pre-line rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
        >
          {notice}
        </p>
      )}
      <label className="mb-5 block text-sm">
        Category
        <select
          value={categoryId}
          disabled={running}
          onChange={(e) => setCategoryId(e.target.value)}
          className="mt-2 block w-full rounded-lg border border-line bg-pcard p-3"
        >
          <option value="">Choose a category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void add(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-12 ${dragging ? "border-accent bg-accent/10" : "border-line bg-pcard"}`}
      >
        <UploadCloud
          className="mx-auto mb-4 h-12 w-12 text-accent"
          aria-hidden
        />
        <h2 className="text-xl font-semibold">Upload videos</h2>
        <p className="mt-2 text-sm text-ink-3">
          Drop multiple video files here, or select them from your device.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={policy?.mimeTypes.join(",") || "video/*"}
          aria-label="Choose video files"
          className="hidden"
          onChange={(e) => {
            void add(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <button
          disabled={!policy}
          onClick={() => input.current?.click()}
          className="mt-5 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Choose videos
        </button>
        {policy && (
          <p className="mt-4 text-xs text-ink-3">
            {policy.mimeTypes.join(", ")} · {PARALLEL_UPLOADS} parallel uploads
            · OpenRouter AI metadata in the site's adult title voice, with
            category drafts only when the AI is unavailable · no
            application-level video size limit
          </p>
        )}
      </div>
      <section aria-label="Upload queue" className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Upload queue ({items.length})</h2>
          <button
            disabled={
              running ||
              !categoryId ||
              !policy ||
              !items.some(
                (i) =>
                  ["Queued", "Failed", "Cancelled"].includes(i.phase) &&
                  i.title.trim(),
              )
            }
            onClick={() => void start()}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm text-white disabled:opacity-40"
          >
            {running
              ? "Uploading…"
              : failed
                ? "Upload queued / retry failed"
                : "Start uploads"}
          </button>
        </div>
        <p role="status" className="text-xs text-ink-3">
          {completed} published ·{" "}
          {items.filter((i) => i.phase === "Encoding").length} encoding ·{" "}
          {failed} failed. Uploads continue while Bunny encodes in the
          background and publishes automatically.
        </p>
        {!items.length && (
          <p className="rounded-xl border border-line p-6 text-center text-sm text-ink-3">
            No files selected yet.
          </p>
        )}
        {items.map((item) => (
          <article
            key={item.id}
            className={`rounded-xl border p-4 ${item.phase === "Completed" ? "border-green-500/30" : item.phase === "Failed" ? "border-red-500/30" : "border-line"} bg-pcard`}
          >
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-void sm:w-40">
                {item.preview ? (
                  <img
                    src={item.preview}
                    alt={`Frame from ${item.file.name}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <p className="p-3 text-center text-xs text-ink-3">
                    {item.phase === "Preparing"
                      ? "Reading local video…"
                      : "No decodable thumbnail"}
                  </p>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Title for ${item.file.name}`}
                    value={item.title}
                    maxLength={240}
                    disabled={
                      running || !!item.categoryId || item.phase === "Completed"
                    }
                    onChange={(e) => {
                      const editedTitle = e.target.value;
                      if (editedTitle.trim()) usedTitles.current.add(editedTitle.trim());
                      patch(item.id, {
                        title: editedTitle,
                        userEditedTitle: true,
                      });
                    }}
                    className="w-full rounded-lg border border-line bg-void px-3 py-2 text-sm"
                  />
                  {["Queued", "Failed", "Cancelled"].includes(item.phase) &&
                    !running &&
                    categoryId && (
                      <button
                        type="button"
                        onClick={async () => {
                          const meta = await generateAiMetadataForCategory(categoryId);
                          patch(item.id, {
                            title: meta.title,
                            description: meta.description,
                            aiGeneratedForCategory: categoryId,
                            userEditedTitle: false,
                            warning: meta.warning,
                          });
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-void px-3 py-2 text-xs text-accent hover:border-accent/50"
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        Generate explicit title
                      </button>
                    )}
                </div>
                {item.description && (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                    {item.description}
                  </p>
                )}
                <p className="mt-2 break-all text-xs text-ink-3">
                  {item.file.name} · {(item.file.size / 1024 / 1024).toFixed(1)}{" "}
                  MB
                  {item.duration
                    ? ` · ${Math.round(item.duration)} seconds`
                    : " · Duration unavailable"}
                </p>
                <p
                  role="status"
                  className="mt-2 flex items-center gap-2 text-sm"
                >
                  {item.phase === "Completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  ) : [
                      "Preparing",
                      "Uploading",
                      "Confirming",
                      "Encoding",
                    ].includes(item.phase) ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : null}
                  <span>{item.phase}</span>
                  {item.phase === "Completed" && (
                    <span className="text-xs text-green-400">· Published</span>
                  )}
                  {item.phase === "Uploading"
                    ? ` · ${Math.floor(item.percent)}%`
                    : ""}
                </p>
                {item.phase === "Uploading" && (
                  <progress
                    aria-label={`Upload progress for ${item.file.name}`}
                    value={item.percent}
                    max={100}
                    className="mt-2 w-full accent-accent"
                  />
                )}
                {item.warning && (
                  <p className="mt-2 text-xs text-amber-400">{item.warning}</p>
                )}
                {item.error && (
                  <p role="alert" className="mt-2 text-xs text-red-400">
                    {item.error}
                  </p>
                )}
                <div className="mt-3 flex gap-4 text-xs">
                  {item.phase === "Encoding" && (
                    <Link href="/admin/videos" className="text-accent">
                      View encoding status in video library
                    </Link>
                  )}
                  {item.phase === "Completed" && item.slug && (
                    <>
                      <Link
                        href={`/video/${item.slug}`}
                        className="text-accent"
                      >
                        View published video
                      </Link>
                      <Link href="/admin/videos" className="text-ink-3 hover:text-ink">
                        View in Videos
                      </Link>
                    </>
                  )}
                  {["Failed", "Cancelled"].includes(item.phase) && (
                    <button
                      disabled={running || !categoryId}
                      onClick={() => void start([item.id])}
                      className="text-accent disabled:opacity-40"
                    >
                      {item.transferred
                        ? "Retry thumbnail / processing / save"
                        : "Retry transfer"}
                    </button>
                  )}
                  {item.phase === "Uploading" && (
                    <button
                      onClick={() => controllers.current.get(item.id)?.abort()}
                      className="text-red-400"
                    >
                      Cancel transfer
                    </button>
                  )}
                  {/* A finished entry can be dropped so the same file can be
                      selected again (for example after its video was deleted
                      in Admin → Videos); only the queue entry goes, never the
                      published video. */}
                  {["Queued", "Preparing", "Completed"].includes(item.phase) &&
                    !running && (
                      <button
                        onClick={() => {
                          if (item.preview) URL.revokeObjectURL(item.preview);
                          current.current = current.current.filter(
                            (i) => i.id !== item.id,
                          );
                          setItems(current.current);
                        }}
                        className="inline-flex items-center gap-1 text-ink-3"
                      >
                        <X className="h-3 w-3" />
                        Remove
                      </button>
                    )}
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
