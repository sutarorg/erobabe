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
    throw new Error(
      `${result.error || "Request failed."}${after ? ` Retry after ${after} seconds.` : ""}`,
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
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const current = useRef(items);
  current.current = items;
  const controllers = useRef(new Map<string, AbortController>());
  const encodingWatchers = useRef(new Map<string, AbortController>());
  const usedTitles = useRef(new Set<string>());
  const alive = useRef(true);
  const busy = useRef(false);
  const decodeQueue = useRef<Promise<unknown>>(Promise.resolve());

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

  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  async function generateAiMetadataForItem(
    item: Item,
    targetCategoryId: string,
  ): Promise<{ title: string; description: string }> {
    const categoryLabel =
      categories.find((c) => c.id === targetCategoryId)?.label || "Mature";
    const existingList = Array.from(usedTitles.current);
    try {
      const response = await fetch("/api/metadata/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: item.file.name,
          title: item.title,
          category: categoryLabel,
          existingTitles: existingList,
        }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.suggestion?.title) {
        const nextTitle = String(data.suggestion.title).trim();
        const nextDescription = String(data.suggestion.description || "").trim();
        usedTitles.current.add(nextTitle);
        return { title: nextTitle, description: nextDescription };
      }
      if (!response.ok) {
        const fallback = generateCategoryFallbackMetadata(
          item.file.name,
          categoryLabel,
          existingList,
        );
        usedTitles.current.add(fallback.title);
        return { title: fallback.title, description: fallback.description };
      }
    } catch {
      const fallback = generateCategoryFallbackMetadata(
        item.file.name,
        categoryLabel,
        existingList,
      );
      usedTitles.current.add(fallback.title);
      return { title: fallback.title, description: fallback.description };
    }
    const fallback = generateCategoryFallbackMetadata(
      item.file.name,
      categoryLabel,
      existingList,
    );
    return {
      title: item.title,
      description: item.description || fallback.description,
    };
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
    let latest = current.current.find((i) => i.id === item.id)!;
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    try {
      if (!latest.thumbnail && !latest.thumbnailPath) {
        patch(item.id, { phase: "Preparing", error: undefined });
        const generated = await prepareThumbnail(item.file);
        patch(item.id, {
          ...generated,
          preview: generated.thumbnail
            ? URL.createObjectURL(generated.thumbnail)
            : undefined,
        });
        latest = current.current.find((i) => i.id === item.id)!;
        if (!latest.thumbnail)
          throw new Error(
            "Thumbnail generation failed. Retry with a browser-decodable source; video will not be published without a real frame thumbnail.",
          );
      }
      if (controller.signal.aborted) throw new UploadAbortedError();
      if (!latest.transferred) {
        const targetCategoryId = latest.categoryId || categoryId;
        patch(item.id, {
          phase: "Preparing",
          error: undefined,
          categoryId: targetCategoryId,
        });
        latest = current.current.find((i) => i.id === item.id)!;

        if (
          !latest.userEditedTitle &&
          latest.aiGeneratedForCategory !== targetCategoryId
        ) {
          const aiMeta = await generateAiMetadataForItem(
            latest,
            targetCategoryId,
          );
          if (controller.signal.aborted) throw new UploadAbortedError();
          patch(item.id, {
            title: aiMeta.title,
            description: aiMeta.description,
            aiGeneratedForCategory: targetCategoryId,
          });
          latest = current.current.find((i) => i.id === item.id)!;
        }

        const session = await json<BunnyUploadTarget>(
          "/api/videos/bunny/sessions",
          {
            sessionId: item.id,
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
        if (session.completed) {
          patch(item.id, {
            phase: "Completed",
            slug: session.slug,
            percent: 100,
          });
          return;
        }
        if (controller.signal.aborted) throw new UploadAbortedError();
        if (!session.transferred) {
          patch(item.id, { phase: "Uploading", percent: 0 });
          await uploadBunnyVideo(session, item.file, {
            title: latest.title,
            signal: controller.signal,
            onProgress: (p) => patch(item.id, { percent: p.percent }),
          });
        }
        patch(item.id, { transferred: true });
      }
      // Cancellation is disabled after transfer: persistence must not be abandoned accidentally.
      patch(item.id, { phase: "Confirming", error: undefined });
      latest = current.current.find((i) => i.id === item.id)!;
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
          patch(item.id, { thumbnailPath: target.storagePath });
        } catch {
          throw new Error(
            "Video transferred, but thumbnail storage failed. Retry to store the thumbnail and confirm without re-uploading the video.",
          );
        }
      }
      latest = current.current.find((i) => i.id === item.id)!;
      if (controller.signal.aborted) throw new UploadAbortedError();
      const done = await json<{
        slug?: string;
        processing?: boolean;
        providerStatus?: string;
        progress?: number;
      }>("/api/videos/bunny/confirm", {
        sessionId: item.id,
        thumbnailPath: latest.thumbnailPath || null,
      });
      if (!done.processing && done.slug) {
        patch(item.id, {
          phase: "Completed",
          percent: 100,
          slug: done.slug,
          warning: undefined,
        });
        return;
      }
      patch(item.id, {
        phase: "Encoding",
        percent: 100,
        slug: done.slug,
        warning: `Bunny ${done.providerStatus || "processing"} · ${Math.floor(done.progress || 0)}% encoding`,
      });
      // Keep encoding checks separate from the upload worker so the next file
      // starts immediately instead of waiting for Bunny's transcoder.
      void watchEncoding(item.id);
    } catch (e) {
      if (
        /Thumbnail (storage failed|generation required)/i.test(
          (e as Error).message,
        )
      )
        patch(item.id, { thumbnailPath: undefined });
      patch(item.id, {
        phase: e instanceof UploadAbortedError ? "Cancelled" : "Failed",
        error: (e as Error).message,
      });
      await fetch("/api/videos/bunny/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: item.id,
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
      controllers.current.delete(item.id);
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
            Local files → Bunny Stream with OpenRouter AI metadata and automatic
            publishing on encoding completion.
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
            · OpenRouter AI metadata · no application-level video size limit
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
                    onChange={(e) =>
                      patch(item.id, {
                        title: e.target.value,
                        userEditedTitle: true,
                      })
                    }
                    className="w-full rounded-lg border border-line bg-void px-3 py-2 text-sm"
                  />
                  {["Queued", "Failed", "Cancelled"].includes(item.phase) &&
                    !running &&
                    categoryId && (
                      <button
                        type="button"
                        onClick={async () => {
                          const meta = await generateAiMetadataForItem(
                            item,
                            categoryId,
                          );
                          patch(item.id, {
                            title: meta.title,
                            description: meta.description,
                            aiGeneratedForCategory: categoryId,
                            userEditedTitle: false,
                          });
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-void px-3 py-2 text-xs text-accent hover:border-accent/50"
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        AI Meta
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
                  {["Queued", "Preparing"].includes(item.phase) && !running && (
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
