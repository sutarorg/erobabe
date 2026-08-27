import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CalendarClock, CheckCircle2, CloudUpload, CopyCheck, ImagePlus,
  Loader2, Trash2, Wand2, XCircle,
} from "lucide-react";
import { api, type DuplicateMatch } from "./api";
import { Btn, Toggle, useFetch } from "./ui";
import { fmtBytes, probeVideoFile, uploadToStorage, UploadCancelled } from "./uploader";
import {
  analyzeComplexity, analyzeVideo, compressionSupported, compressVideoAggressive,
  planEncode, CompressionCancelled,
} from "./compress";
import { fingerprintFile } from "./fingerprint";
import { buildTrendingTags, generateTags } from "./autoTags";
import {
  descriptionForIndex, generateSeoDescription, generateSeoTitle,
  scheduleForIndex, titleFromFileName, PUBLISH_INTERVAL_MS,
} from "./bulkDefaults";
import { cn } from "@/lib/format";

/** Hard ceiling per bulk action. */
const MAX_FILES = 20;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

type ItemStage =
  | "queued" | "checking" | "duplicate" | "optimizing"
  | "uploading" | "finishing" | "done" | "error" | "skipped";

interface BulkItem {
  key: string;
  file: File;
  title: string;
  poster: string | null;
  thumbOverride: string | null;
  durationS: number | null;
  hash: string | null;
  duplicate: DuplicateMatch | null;
  /** Admin chose to upload despite the duplicate warning. */
  allowDuplicate: boolean;
  stage: ItemStage;
  progress: number;
  error: string | null;
  videoId: string | null;
  publishAt: Date | null;
}

const STAGE_LABEL: Record<ItemStage, string> = {
  queued: "Queued",
  checking: "Checking…",
  duplicate: "Duplicate found",
  optimizing: "Optimizing…",
  uploading: "Uploading…",
  finishing: "Finalizing…",
  done: "Scheduled",
  error: "Failed",
  skipped: "Skipped",
};

const STAGE_STYLE: Record<ItemStage, string> = {
  queued: "bg-white/6 text-fog-400",
  checking: "bg-sky-500/12 text-sky-300",
  duplicate: "bg-amber-500/12 text-amber-300",
  optimizing: "bg-violet-500/12 text-violet-300",
  uploading: "bg-brand-500/12 text-brand-300",
  finishing: "bg-brand-500/12 text-brand-300",
  done: "bg-emerald-500/12 text-emerald-300",
  error: "bg-red-500/12 text-red-300",
  skipped: "bg-white/6 text-fog-500",
};

const fmtTime = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function BulkUpload({ onDone }: { onDone?: () => void }) {
  const [items, setItems] = useState<BulkItem[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [optimizeEnabled, setOptimizeEnabled] = useState(true);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const catsFetch = useFetch(() => api.categories(), []);
  const recentFetch = useFetch(() => api.videos({ limit: 100, sort: "newest" }), []);

  const trending = useMemo(() => {
    const list = recentFetch.data?.items ?? [];
    return buildTrendingTags(
      list.map((v) => ({
        tags: v.tags,
        views: v.views,
        daysAgo: v.published_at
          ? Math.max(0, Math.floor((Date.now() - Date.parse(v.published_at)) / 86_400_000))
          : 0,
      }))
    );
  }, [recentFetch.data]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback((key: string, changes: Partial<BulkItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...changes } : i)));
  }, []);

  /* ── Selection ── */
  const addFiles = async (fileList: FileList | null) => {
    if (!fileList?.length || running) return;
    setError(null);
    const incoming = [...fileList].filter((f) => f.type.startsWith("video/"));
    if (!incoming.length) return setError("Only video files can be uploaded.");

    const room = MAX_FILES - items.length;
    if (room <= 0) return setError(`Bulk upload is limited to ${MAX_FILES} videos per batch.`);
    const accepted = incoming.slice(0, room);
    if (incoming.length > room) {
      setError(`Only ${room} more video${room === 1 ? "" : "s"} can be added — the limit is ${MAX_FILES} per batch.`);
    }

    const oversize = accepted.filter((f) => f.size > MAX_BYTES);
    if (oversize.length) setError(`${oversize.length} file(s) exceed the 2 GB limit and were skipped.`);

    const next: BulkItem[] = accepted
      .filter((f) => f.size <= MAX_BYTES)
      .map((file, i) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${items.length + i}`,
        file,
        title: titleFromFileName(file.name),
        poster: null,
        thumbOverride: null,
        durationS: null,
        hash: null,
        duplicate: null,
        allowDuplicate: false,
        stage: "queued",
        progress: 0,
        error: null,
        videoId: null,
        publishAt: null,
      }));

    setItems((prev) => [...prev, ...next]);

    // Poster frame, duration and fingerprint, resolved in the background.
    for (const item of next) {
      void (async () => {
        patch(item.key, { stage: "checking" });
        const [probe, hash] = await Promise.all([
          probeVideoFile(item.file),
          fingerprintFile(item.file),
        ]);
        let duplicate: DuplicateMatch | null = null;
        try {
          duplicate = (await api.checkDuplicate(hash)).duplicate;
        } catch {
          duplicate = null;
        }
        patch(item.key, {
          poster: probe.poster,
          durationS: probe.durationS,
          hash,
          duplicate,
          stage: duplicate ? "duplicate" : "queued",
        });
      })();
    }
  };

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  /* ── Run the batch sequentially ── */
  const start = async () => {
    if (!items.length || running) return;
    setRunning(true);
    setFinished(false);
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;

    const batchId = `bulk-${Date.now().toString(36)}`;
    const base = Date.now();
    // Snapshot so admin edits mid-run don't shift the schedule.
    const queue = items.filter((i) => !(i.duplicate && !i.allowDuplicate));
    let position = 0;

    for (const snapshot of queue) {
      if (ac.signal.aborted) break;
      // Always read the freshest title/thumbnail for this row.
      const current = () => itemsRef.current.find((i) => i.key === snapshot.key) ?? snapshot;
      const item = current();

      try {
        let payload = item.file;

        /* Optimize */
        if (optimizeEnabled && compressionSupported()) {
          const analysis = await analyzeVideo(item.file);
          if (analysis) {
            const complexity = await analyzeComplexity(item.file);
            const plan = planEncode(analysis, complexity ? complexity.overall : null);
            if (plan.compress) {
              patch(item.key, { stage: "optimizing", progress: 0 });
              try {
                const res = await compressVideoAggressive(item.file, plan, {
                  signal: ac.signal,
                  onProgress: (r) => patch(item.key, { progress: Math.round(r * 100) }),
                });
                payload = res.file;
              } catch (e) {
                if (e instanceof CompressionCancelled) throw e;
                payload = item.file; // best-effort
              }
            }
          }
        }

        /* Upload */
        patch(item.key, { stage: "uploading", progress: 0 });
        const plan = await api.createUpload({
          fileName: payload.name,
          size: payload.size,
          contentType: payload.type || "video/mp4",
          durationS: item.durationS,
          contentHash: item.hash ?? undefined,
          bulkBatch: batchId,
          title: current().title,
        });
        const etags = await uploadToStorage(payload, plan, {
          signal: ac.signal,
          onProgress: (loaded, total) =>
            patch(item.key, { progress: Math.round((loaded / total) * 100) }),
        });

        patch(item.key, { stage: "finishing", progress: 100 });
        await api.completeUpload(plan.videoId, {
          parts: etags.length ? etags : undefined,
          durationS: item.durationS,
        });

        /* Thumbnail — admin override wins, else the captured poster. */
        const fresh = current();
        const thumb = fresh.thumbOverride ?? fresh.poster;
        if (thumb) {
          await api
            .uploadMedia({ dataUrl: thumb, kind: "thumbnail", refId: plan.videoId })
            .catch(() => {});
        }

        /* Automated metadata */
        const title = fresh.title.trim() || titleFromFileName(item.file.name);
        const description = descriptionForIndex(position);
        const categoryName =
          catsFetch.data?.categories.find((c) =>
            title.toLowerCase().includes(c.name.toLowerCase())
          )?.name ?? null;
        const tags = generateTags(title, description, trending, categoryName, 5);

        await api.patchVideo(plan.videoId, {
          title,
          description,
          tags,
          seoTitle: generateSeoTitle(title),
          seoDescription: generateSeoDescription(description),
        });

        /* Stay a draft, released on the hourly schedule. */
        const publishAt = scheduleForIndex(position, base);
        let scheduled = false;
        try {
          await api.scheduleVideo(plan.videoId, publishAt.toISOString());
          scheduled = true;
        } catch {
          scheduled = false; // migration 0007 not applied yet
        }

        patch(item.key, {
          stage: "done",
          progress: 100,
          videoId: plan.videoId,
          publishAt: scheduled ? publishAt : null,
          error: scheduled ? null : "Saved as draft — run migration 0007 to enable auto-publishing.",
        });
        position += 1;
      } catch (e) {
        if (e instanceof UploadCancelled || e instanceof CompressionCancelled) {
          patch(item.key, { stage: "skipped", error: "Cancelled" });
          break;
        }
        patch(item.key, {
          stage: "error",
          error: e instanceof Error ? e.message : "Upload failed",
        });
      }
    }

    setRunning(false);
    setFinished(true);
    onDone?.();
  };

  // Latest rows for the runner, without restarting it on every keystroke.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const pending = items.filter((i) => !(i.duplicate && !i.allowDuplicate));
  const completed = items.filter((i) => i.stage === "done");
  const duplicates = items.filter((i) => i.duplicate && !i.allowDuplicate);

  return (
    <div className="space-y-5">
      {/* Picker */}
      {!running && items.length < MAX_FILES && (
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition md:p-12",
            drag ? "border-brand-500/60 bg-brand-500/8" : "border-white/12 bg-ink-900/40 hover:border-white/25"
          )}
        >
          <input
            type="file"
            accept="video/*"
            multiple
            className="sr-only"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
          />
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/20 to-violet-600/20 text-brand-300 ring-1 ring-brand-500/30">
            <CloudUpload className="size-7" aria-hidden />
          </span>
          <p className="mt-4 text-base font-semibold text-white">
            Select up to {MAX_FILES} videos
          </p>
          <p className="mt-1 text-sm text-fog-500">
            {items.length > 0
              ? `${items.length} selected · ${MAX_FILES - items.length} slots left`
              : "Drag & drop, or click to browse. MP4, MOV, WEBM up to 2 GB each."}
          </p>
        </label>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {items.length > 0 && (
        <>
          {/* Batch settings */}
          <div className="rounded-2xl border border-white/6 bg-ink-900/60 p-4">
            <div className="flex items-start gap-3">
              <Wand2 className={cn("mt-0.5 size-4 shrink-0", optimizeEnabled ? "text-brand-400" : "text-fog-600")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white">Automatic optimization</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-fog-500">
                  {optimizeEnabled
                    ? "Each video is re-encoded to the smallest size that preserves its visual quality."
                    : "Off — original files are uploaded unchanged."}
                </p>
              </div>
              <Toggle checked={optimizeEnabled} onChange={setOptimizeEnabled} label="Toggle automatic optimization" disabled={running} />
            </div>

            <div className="mt-3 flex items-start gap-3 border-t border-white/6 pt-3">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-400" aria-hidden />
              <p className="text-[11px] leading-relaxed text-fog-500">
                All {pending.length} video{pending.length === 1 ? "" : "s"} upload as <span className="text-fog-300">drafts</span>,
                then publish automatically <span className="text-fog-300">one per hour</span> — first at{" "}
                <span className="text-brand-300">{fmtTime(scheduleForIndex(0))}</span>, last around{" "}
                <span className="text-brand-300">
                  {fmtTime(new Date(Date.now() + pending.length * PUBLISH_INTERVAL_MS))}
                </span>.
                Titles, tags, descriptions and SEO metadata are generated automatically.
              </p>
            </div>
          </div>

          {duplicates.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs text-amber-300">
              <CopyCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              {duplicates.length} duplicate{duplicates.length === 1 ? "" : "s"} detected and excluded.
              Use “Upload anyway” on a row to include it.
            </p>
          )}

          {/* Rows */}
          <ul className="space-y-2">
            {items.map((item, i) => (
              <li key={item.key} className="rounded-2xl border border-white/6 bg-ink-900/50 p-3">
                <div className="flex gap-3">
                  <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8 sm:w-36">
                    {item.thumbOverride || item.poster ? (
                      <img src={item.thumbOverride ?? item.poster ?? ""} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center">
                        <Loader2 className="size-4 animate-spin text-fog-600" aria-hidden />
                      </span>
                    )}
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[10px] font-bold text-white">
                      {i + 1}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <input
                      value={item.title}
                      onChange={(e) => patch(item.key, { title: e.target.value })}
                      disabled={running}
                      maxLength={120}
                      aria-label={`Title for video ${i + 1}`}
                      className="w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-1.5 text-sm text-white outline-none transition focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60"
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fog-600">
                      <span>{fmtBytes(item.file.size)}</span>
                      <span className={cn("rounded px-1.5 py-0.5 font-semibold", STAGE_STYLE[item.stage])}>
                        {STAGE_LABEL[item.stage]}
                      </span>
                      {item.publishAt && (
                        <span className="text-emerald-400/90">Publishes {fmtTime(item.publishAt)}</span>
                      )}
                      {item.error && <span className="text-red-400">{item.error}</span>}
                    </div>

                    {item.duplicate && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 p-2 text-[11px] text-amber-200">
                        <CopyCheck className="size-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">
                          Already uploaded as “{item.duplicate.title}” ({item.duplicate.status})
                        </span>
                        <Link
                          to={`/admin/videos/${item.duplicate.id}`}
                          className="font-semibold underline underline-offset-2"
                        >
                          View
                        </Link>
                        {!item.allowDuplicate && !running && (
                          <button
                            type="button"
                            onClick={() => patch(item.key, { allowDuplicate: true, stage: "queued" })}
                            className="rounded border border-amber-400/40 px-1.5 py-0.5 font-semibold hover:bg-amber-400/10"
                          >
                            Upload anyway
                          </button>
                        )}
                      </div>
                    )}

                    {(item.stage === "optimizing" || item.stage === "uploading") && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-[width]"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5">
                    <label
                      className={cn(
                        "grid size-8 cursor-pointer place-items-center rounded-lg border border-white/10 bg-white/4 text-fog-400 transition hover:text-white",
                        running && "pointer-events-none opacity-50"
                      )}
                      title="Upload thumbnail"
                    >
                      <ImagePlus className="size-4" aria-hidden />
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={running}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const reader = new FileReader();
                          reader.onload = () => patch(item.key, { thumbOverride: String(reader.result) });
                          reader.readAsDataURL(f);
                        }}
                      />
                    </label>
                    {!running && item.stage !== "done" && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.key)}
                        aria-label={`Remove video ${i + 1}`}
                        className="grid size-8 place-items-center rounded-lg text-fog-500 transition hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    )}
                    {item.stage === "done" && (
                      <span className="grid size-8 place-items-center text-emerald-400">
                        <CheckCircle2 className="size-4" aria-hidden />
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/6 pt-4">
            {finished && completed.length > 0 && (
              <p className="mr-auto flex items-center gap-2 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="size-4" aria-hidden />
                {completed.length} video{completed.length === 1 ? "" : "s"} scheduled.
              </p>
            )}
            {running ? (
              <Btn variant="ghost" icon={XCircle} onClick={() => abortRef.current?.abort()}>
                Cancel batch
              </Btn>
            ) : (
              <>
                <Btn variant="ghost" onClick={() => { setItems([]); setFinished(false); setError(null); }}>
                  Clear all
                </Btn>
                <Btn
                  variant="primary"
                  icon={CloudUpload}
                  onClick={start}
                  disabled={pending.length === 0 || finished}
                >
                  Upload &amp; schedule {pending.length} video{pending.length === 1 ? "" : "s"}
                </Btn>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
