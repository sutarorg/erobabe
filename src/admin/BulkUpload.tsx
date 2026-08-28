import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CalendarClock, CheckCircle2, CloudUpload, CopyCheck, ImagePlus,
  LayoutGrid, Loader2, Trash2, XCircle,
} from "lucide-react";
import { api, type DuplicateMatch } from "./api";
import { Btn, Select, useFetch } from "./ui";
import { fmtBytes, probeVideoFile, uploadToStorage, UploadCancelled } from "./uploader";

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
  | "queued" | "checking" | "duplicate"
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

  uploading: "bg-brand-500/12 text-brand-300",
  finishing: "bg-brand-500/12 text-brand-300",
  done: "bg-emerald-500/12 text-emerald-300",
  error: "bg-red-500/12 text-red-300",
  skipped: "bg-white/6 text-fog-500",
};

const fmtTime = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function BulkUpload({
  onDone,
  initialFiles,
}: {
  onDone?: () => void;
  /** Files handed over when the admin multi-selects on the single-upload screen. */
  initialFiles?: File[] | null;
}) {
  const [items, setItems] = useState<BulkItem[]>([]);
  const itemsRef = useRef<BulkItem[]>([]);
  itemsRef.current = items;
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  /** Category assigned to every video in the batch ("" = infer from title). */
  const [categoryId, setCategoryId] = useState("");
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
  const addFiles = useCallback(async (source: FileList | File[] | null) => {
    if (!source || source.length === 0 || running) return;
    setError(null);
    // Some Safari/mobile file pickers return an empty MIME type. Accept
    // known video extensions as well as a proper `video/*` MIME value.
    const incoming = Array.from(source).filter(
      (f) =>
        f.type.startsWith("video/") ||
        /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|ogv)$/i.test(f.name)
    );
    if (!incoming.length) return setError("Only video files can be uploaded.");

    const existing = itemsRef.current;
    const room = MAX_FILES - existing.length;
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
        key: `${file.name}-${file.size}-${file.lastModified}-${existing.length + i}-${crypto.randomUUID?.() ?? Date.now()}`,
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

    setItems((prev) => [...prev, ...next].slice(0, MAX_FILES));

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
          duplicate = (await api.checkDuplicate(hash, item.title)).duplicate;
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
  }, [patch, running]);

  // Ingest files handed over from the single-upload screen, once. Passing
  // File[] directly avoids `new DataTransfer()`, which fails on Safari and
  // several embedded/mobile browsers.
  const handedOff = useRef(false);
  useEffect(() => {
    if (handedOff.current || !initialFiles?.length) return;
    handedOff.current = true;
    void addFiles(initialFiles);
  }, [initialFiles, addFiles]);

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

    /*
     * Queue behind anything already scheduled. Without this, a second
     * batch started while an earlier one is still releasing would reuse
     * the same hourly slots and publish two videos at once.
     */
    let base = Date.now();
    try {
      const { available, scheduled } = await api.scheduled();
      if (available && scheduled.length) {
        const latest = scheduled.reduce(
          (max, s) => Math.max(max, Date.parse(s.scheduled_publish_at) || 0),
          0
        );
        if (latest > base) base = latest;
      }
    } catch {
      /* Scheduling table unavailable — fall back to "from now". */
    }
    // Snapshot so admin edits mid-run don't shift the schedule.
    const queue = items.filter((i) => !(i.duplicate && !i.allowDuplicate));
    let position = 0;

    for (const snapshot of queue) {
      if (ac.signal.aborted) break;
      // Always read the freshest title/thumbnail for this row.
      const current = () => itemsRef.current.find((i) => i.key === snapshot.key) ?? snapshot;
      const item = current();

      try {
        // Files upload exactly as selected.
        const payload = item.file;

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
        // The admin's choice wins; otherwise infer from the title.
        const chosen = catsFetch.data?.categories.find((c) => c.id === categoryId);
        const inferred = catsFetch.data?.categories.find((c) =>
          title.toLowerCase().includes(c.name.toLowerCase())
        );
        const category = chosen ?? inferred ?? null;
        const tags = generateTags(title, description, trending, category?.name ?? null, 5);

        await api.patchVideo(plan.videoId, {
          title,
          description,
          tags,
          ...(category ? { categoryId: category.id } : {}),
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
        if (e instanceof UploadCancelled) {
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
    // Refresh so a follow-up batch queues behind what was just scheduled.
    scheduledFetch.reload();
    onDone?.();
  };

  /* Preview the real start time — after anything already queued. */
  const scheduledFetch = useFetch(() => api.scheduled(), []);
  const alreadyScheduled = scheduledFetch.data?.available
    ? (scheduledFetch.data.scheduled ?? [])
    : [];
  const pendingScheduled = alreadyScheduled.length;
  const queueBase = alreadyScheduled.reduce(
    (max, s) => Math.max(max, Date.parse(s.scheduled_publish_at) || 0),
    Date.now()
  );

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
            accept="video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.mpeg,.mpg,.ogv"
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
            {/* Category applies to every video in the batch. */}
            <div className="flex items-start gap-3">
              <LayoutGrid className="mt-0.5 size-4 shrink-0 text-brand-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <label htmlFor="bulk-category" className="text-xs font-semibold text-white">
                  Category
                </label>
                <p className="mt-0.5 text-[11px] leading-relaxed text-fog-500">
                  Applied to all {pending.length} video{pending.length === 1 ? "" : "s"} in this batch.
                </p>
              </div>
              <Select
                id="bulk-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={running || catsFetch.loading}
                aria-label="Category for this batch"
                className="w-44 shrink-0"
              >
                <option value="">Auto-detect from title</option>
                {(catsFetch.data?.categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>

            <div className="mt-3 flex items-start gap-3 border-t border-white/6 pt-3">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-400" aria-hidden />
              <p className="text-[11px] leading-relaxed text-fog-500">
                All {pending.length} video{pending.length === 1 ? "" : "s"} upload as <span className="text-fog-300">drafts</span>,
                then publish automatically <span className="text-fog-300">one per hour</span> — first at{" "}
                <span className="text-brand-300">{fmtTime(scheduleForIndex(0, queueBase))}</span>, last around{" "}
                <span className="text-brand-300">
                  {fmtTime(new Date(queueBase + pending.length * PUBLISH_INTERVAL_MS))}
                </span>.
                {queueBase > Date.now() + 60_000 && (
                  <> Queued after {pendingScheduled} already-scheduled video{pendingScheduled === 1 ? "" : "s"}.</>
                )}{" "}
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

                    {item.stage === "uploading" && (
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
