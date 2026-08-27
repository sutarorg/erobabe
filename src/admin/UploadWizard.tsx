import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CloudUpload, CopyCheck, FileVideo,
  ImagePlus, Loader2, RefreshCw, Sparkles, Wand2, XCircle,
} from "lucide-react";
import { api, type UploadPlan, type MultiPlan } from "./api";
import { fmtBytes, fmtDuration, probeVideoFile, uploadMissingParts, uploadToStorage, UploadCancelled } from "./uploader";
import {
  analyzeComplexity, analyzeVideo, compressionSupported, compressVideoAggressive, planEncode,
  CompressionCancelled, type EncodePlan, type VideoAnalysis,
} from "./compress";
import { Btn, Field, FieldGroup, Input, PageHeader, Select, TagEditor, Textarea, Toggle, useFetch } from "./ui";
import { buildTrendingTags, generateTags } from "./autoTags";
import { fingerprintFile } from "./fingerprint";
import type { DuplicateMatch } from "./api";
import BulkUpload from "./BulkUpload";
import { titleFromFileName } from "./bulkDefaults";
import { toast } from "@/components/Feedback";
import { cn } from "@/lib/format";

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

type Phase =
  | { step: "select" }
  | { step: "optimizing" }
  | { step: "uploading" }
  | { step: "finishing" }
  | { step: "details" };

/** Single vs. bulk upload switch. */
function ModeSwitch({ mode, onChange }: { mode: "single" | "bulk"; onChange: (m: "single" | "bulk") => void }) {
  return (
    <div className="flex rounded-lg border border-white/8 bg-ink-900/60 p-1">
      {(["single", "bulk"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition",
            mode === m
              ? "bg-gradient-to-r from-brand-500 to-violet-600 text-white"
              : "text-fog-400 hover:text-white"
          )}
        >
          {m === "single" ? "Single" : "Bulk (up to 20)"}
        </button>
      ))}
    </div>
  );
}

export default function UploadWizard() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  /** Files passed straight to bulk mode when several are chosen at once. */
  const [handoff, setHandoff] = useState<File[] | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "select" });
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<{ durationS: number | null; poster: string | null } | null>(null);
  const [probing, setProbing] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [encodePlan, setEncodePlan] = useState<EncodePlan | null>(null);
  const [optimizePct, setOptimizePct] = useState(0);
  const [optimized, setOptimized] = useState<File | null>(null);
  /** Automatic optimization is opt-in — the admin switches it on per upload. */
  const [optimizeEnabled, setOptimizeEnabled] = useState(false);
  /** Fingerprint of the source file + any matching prior upload. */
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [dupReason, setDupReason] = useState<"file" | "title" | null>(null);
  const [dupAcknowledged, setDupAcknowledged] = useState(false);

  const [plan, setPlan] = useState<UploadPlan | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [failedParts, setFailedParts] = useState<number[]>([]);
  const [etags, setEtags] = useState<{ partNumber: number; etag: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const startAtRef = useRef(0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [thumbOverride, setThumbOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const catsFetch = useFetch(() => api.categories(), []);
  const categories = catsFetch.data?.categories ?? [];

  /* ── Automatic tagging ──
     Trending tags come from the live catalog, ranked by momentum, and
     are matched against the title/description to pick the best five. */
  const tagsFetch = useFetch(() => api.videos({ limit: 100, sort: "newest" }), []);
  const trending = useMemo(() => {
    const items = tagsFetch.data?.items ?? [];
    return buildTrendingTags(
      items.map((v) => ({
        tags: v.tags,
        views: v.views,
        daysAgo: v.published_at
          ? Math.max(0, Math.floor((Date.now() - Date.parse(v.published_at)) / 86_400_000))
          : 0,
      }))
    );
  }, [tagsFetch.data]);
  /** Cleared once the admin edits tags, so we never overwrite their work. */
  const tagsTouched = useRef(false);
  const [tagsAuto, setTagsAuto] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Accept whatever the admin chose. Selecting several files switches
   * straight to bulk mode instead of silently ignoring the extras.
   */
  const acceptFiles = (list: FileList | null) => {
    const videos = [...(list ?? [])].filter((f) => f.type.startsWith("video/"));
    if (videos.length > 1) {
      setHandoff(videos.slice(0, 20));
      setMode("bulk");
      return;
    }
    pick(videos[0] ?? list?.[0] ?? null);
  };

  const pick = (f: File | null) => {
    setError(null);
    setProbe(null);
    setThumbOverride(null);
    setAnalysis(null);
    setEncodePlan(null);
    setOptimized(null);
    setOptimizePct(0);
    setContentHash(null);
    setDuplicate(null);
    setDupAcknowledged(false);
    if (!f) return setFile(null);
    if (!f.type.startsWith("video/")) return setError("Only video files are allowed (mp4, mov, webm…)");
    if (f.size > MAX_BYTES) return setError(`File exceeds the 2 GB limit (${fmtBytes(f.size)})`);
    setFile(f);
    setTitle(f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "));
    setProbing(true);
    // Analyze the source, measure its complexity, then compute the optimal
    // encode settings from both.
    Promise.all([probeVideoFile(f), analyzeVideo(f)])
      .then(async ([p, a]) => {
        setProbe(p);
        setAnalysis(a);
        if (a && compressionSupported()) {
          const complexity = await analyzeComplexity(f);
          setEncodePlan(planEncode(a, complexity ? complexity.overall : null));
        }
        setProbing(false);
      })
      .catch(() => setProbing(false));

    // Fingerprint the source and warn if the file — or its title — already exists.
    void (async () => {
      const hash = await fingerprintFile(f);
      setContentHash(hash);
      try {
        const res = await api.checkDuplicate(hash, titleFromFileName(f.name));
        setDuplicate(res.duplicate);
        setDupReason(res.reason);
      } catch {
        setDuplicate(null);
        setDupReason(null);
      }
    })();
  };

  const startUpload = async () => {
    if (!file) return;
    setError(null);
    setLoaded(0);
    setFailedParts([]);
    setEtags([]);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      // ── Step A: automatic optimization ──
      let payload = optimized ?? file;
      if (!optimized && optimizeEnabled && encodePlan?.compress) {
        setPhase({ step: "optimizing" });
        setOptimizePct(0);
        try {
          const result = await compressVideoAggressive(file, encodePlan, {
            signal: ac.signal,
            onProgress: (r) => setOptimizePct(Math.round(r * 100)),
          });
          payload = result.file;
          setOptimized(payload);
          // Reflect any leaner retry settings back into the summary.
          if (result.plan !== encodePlan) setEncodePlan(result.plan);
        } catch (e) {
          if (e instanceof CompressionCancelled) {
            setPhase({ step: "select" });
            return;
          }
          // Optimization is best-effort — fall back to the original file.
          payload = file;
        }
      }

      // ── Step B: direct-to-R2 upload ──
      setPhase({ step: "uploading" });
      startAtRef.current = Date.now();
      const p = await api.createUpload({
        fileName: payload.name,
        size: payload.size,
        contentType: payload.type || "video/mp4",
        durationS: probe?.durationS ?? null,
        contentHash: contentHash ?? undefined,
      });
      setPlan(p);

      const doneEtags = await uploadToStorage(payload, p, {
        signal: ac.signal,
        onProgress: (l) => setLoaded(l),
      });
      setEtags(doneEtags);

      setPhase({ step: "finishing" });
      await api.completeUpload(p.videoId, { parts: doneEtags.length ? doneEtags : undefined, durationS: probe?.durationS ?? null });

      if (probe?.poster) {
        api.uploadMedia({ dataUrl: probe.poster, kind: "thumbnail", refId: p.videoId }).catch(() => {});
      }

      toast("Upload complete — processing finished");
      setPhase({ step: "details" });
      autoFillTags(title, description, categoryId);
    } catch (e) {
      if (e instanceof UploadCancelled) {
        setPhase({ step: "select" });
        setFile(null);
        setPlan(null);
        return;
      }
      const failed = (e as Error & { failedParts?: number[] }).failedParts;
      if (failed?.length) setFailedParts(failed);
      setError(e instanceof Error ? e.message : "Upload failed");
      setPhase({ step: "select" });
    }
  };

  /** Resume a failed multipart upload using the existing plan (no duplicate rows). */
  const retryFailed = async () => {
    if (!file || !plan || plan.mode !== "multipart") return startUpload();
    setError(null);
    setPhase({ step: "uploading" });
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    startAtRef.current = Date.now();
    const missingBytes = failedParts.reduce(
      (n, pn) => n + ((plan as MultiPlan).parts.find((x) => x.partNumber === pn)?.size ?? plan.chunkSize),
      0
    );
    setLoaded(Math.max(0, file.size - missingBytes));
    try {
      const doneEtags = await uploadMissingParts(file, plan, failedParts, etags, {
        signal: ac.signal,
        onProgress: (l) => setLoaded(Math.min(file.size, file.size - missingBytes + l)),
      });
      setEtags(doneEtags);
      setFailedParts([]);
      setPhase({ step: "finishing" });
      await api.completeUpload(plan.videoId, { parts: doneEtags, durationS: probe?.durationS ?? null });
      if (probe?.poster) api.uploadMedia({ dataUrl: probe.poster, kind: "thumbnail", refId: plan.videoId }).catch(() => {});
      toast("Upload complete — processing finished");
      setPhase({ step: "details" });
    } catch (e) {
      if (e instanceof UploadCancelled) {
        setPhase({ step: "select" });
        return;
      }
      const failed = (e as Error & { failedParts?: number[] }).failedParts;
      if (failed?.length) setFailedParts(failed);
      setError(e instanceof Error ? e.message : "Upload failed");
      setPhase({ step: "select" });
    }
  };

  /**
   * Write the five best tags straight into the Tags field. Runs whenever
   * the title, description or category changes — until the admin edits
   * the tags themselves, after which it stops interfering.
   */
  const autoFillTags = useCallback(
    (t: string, d: string, catId: string) => {
      if (tagsTouched.current) return;
      const categoryName = categories.find((c) => c.id === catId)?.name ?? null;
      const generated = generateTags(t, d, trending, categoryName, 5);
      if (generated.length) {
        setTags(generated);
        setTagsAuto(true);
      }
    },
    [categories, trending]
  );

  // Keep tags in step with the metadata while they remain auto-generated.
  useEffect(() => {
    if (phase.step !== "details" || tagsTouched.current) return;
    const id = window.setTimeout(() => autoFillTags(title, description, categoryId), 400);
    return () => window.clearTimeout(id);
  }, [phase.step, title, description, categoryId, autoFillTags]);

  /** Explicit regenerate: always overwrites, even after manual edits. */
  const regenerateTags = useCallback(() => {
    tagsTouched.current = false;
    const categoryName = categories.find((c) => c.id === categoryId)?.name ?? null;
    const generated = generateTags(title, description, trending, categoryName, 5);
    if (generated.length) {
      setTags(generated);
      setTagsAuto(true);
      toast(`Generated ${generated.length} tags`);
    } else {
      toast("Add a title or description first", "info");
    }
  }, [title, description, categoryId, categories, trending]);

  const cancelUpload = async () => {
    abortRef.current?.abort();
    if (plan) await api.abortUpload(plan.videoId).catch(() => {});
    setPhase({ step: "select" });
    setFile(null);
    setPlan(null);
    toast("Upload cancelled", "info");
  };

  const saveDraft = async (publishAfter = false) => {
    if (!plan) return;
    setSaving(true);
    try {
      await api.patchVideo(plan.videoId, {
        title: title.trim() || "Untitled",
        description: description.trim(),
        categoryId: categoryId || null,
        tags,
      });
      if (thumbOverride) {
        await api.uploadMedia({ dataUrl: thumbOverride, kind: "thumbnail", refId: plan.videoId }).catch(() => {});
      }
      if (publishAfter) {
        await api.publish(plan.videoId);
        toast("Published — now live on EroBabe");
      } else {
        toast("Saved as draft — nothing is public yet");
      }
      navigate(`/admin/videos/${plan.videoId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "info");
      setSaving(false);
    }
  };

  const pct = file ? Math.min(Math.round((loaded / file.size) * 100), 100) : 0;
  const elapsed = (Date.now() - (startAtRef.current || Date.now())) / 1000;
  const speed = elapsed > 1 ? loaded / elapsed : 0;
  const eta = speed > 0 && file ? Math.max(0, (file.size - loaded) / speed) : 0;

  if (mode === "bulk") {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Upload videos"
          sub="Bulk upload up to 20 videos. Metadata is generated automatically and videos publish one per hour."
          actions={<ModeSwitch mode={mode} onChange={(m) => { setMode(m); setHandoff(null); }} />}
        />
        <BulkUpload initialFiles={handoff} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Upload video"
        sub="Upload → Process → Draft → Preview → Publish. Nothing goes live until you publish it."
        actions={phase.step === "select" ? <ModeSwitch mode={mode} onChange={setMode} /> : undefined}
      />

      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-2 text-xs font-semibold">
        {["1 · File", optimizeEnabled ? "2 · Optimize & upload" : "2 · Upload", "3 · Details"].map((label, i) => {
          const current = phase.step === "select" ? 0 : phase.step === "details" ? 2 : 1;
          return (
            <li key={label} className="flex items-center gap-2">
              <span className={cn("grid size-6 place-items-center rounded-full text-[10px]", i < current ? "bg-emerald-500/20 text-emerald-300" : i === current ? "bg-gradient-to-r from-brand-500 to-violet-600 text-white" : "bg-white/6 text-fog-500")}>
                {i < current ? <CheckCircle2 className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={i === current ? "text-white" : "text-fog-600"}>{label}</span>
              {i < 2 && <span className="h-px w-6 bg-white/10 sm:w-10" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/8 p-4 text-sm text-red-300" role="alert">
          <AlertTriangle className="mt-0.5 size-4.5 shrink-0" aria-hidden />
          <div className="flex-1">{error}</div>
          {failedParts.length > 0 && (
            <Btn size="sm" variant="subtle" onClick={retryFailed}>Resume failed parts</Btn>
          )}
        </div>
      )}

      {/* ── Step 1: pick file ── */}
      {phase.step === "select" && (
        <>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              acceptFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 text-center transition md:p-16",
              drag ? "border-brand-500/60 bg-brand-500/8" : "border-white/12 bg-ink-900/40 hover:border-white/25"
            )}
          >
            <input
              type="file"
              accept="video/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                acceptFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <span className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/20 to-violet-600/20 text-brand-300 ring-1 ring-brand-500/30">
              <CloudUpload className="size-8" aria-hidden />
            </span>
            <p className="mt-5 text-base font-semibold text-white">Drag &amp; drop your video</p>
            <p className="mt-1 text-sm text-fog-500">or click to browse — MP4, MOV, WEBM up to 2 GB</p>
            <p className="mt-3 text-[11px] text-fog-600">
              Select several files at once to switch to bulk upload (up to 20).
            </p>
          </label>

          {file && (
            <div className="mt-5 rounded-2xl border border-white/8 bg-ink-900/60 p-4 animate-fade-up">
              <div className="flex items-center gap-4">
                <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8">
                  {probing ? (
                    <span className="absolute inset-0 grid place-items-center"><Loader2 className="size-5 animate-spin text-fog-500" aria-hidden /></span>
                  ) : probe?.poster ? (
                    <img src={probe.poster} alt="Captured poster frame" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <FileVideo className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-fog-600" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{file.name}</p>
                  <p className="mt-1 text-xs text-fog-500">
                    {fmtBytes(file.size)} · {probing ? "probing…" : fmtDuration(probe?.durationS)}
                    {analysis ? ` · ${analysis.width}×${analysis.height}` : ""}
                  </p>
                  {probe?.poster && <p className="mt-1 text-[11px] text-emerald-400/80">Poster frame captured automatically</p>}
                </div>
                <button type="button" onClick={() => pick(null)} aria-label="Remove file" className="grid size-9 place-items-center rounded-full text-fog-500 hover:bg-white/5 hover:text-white">
                  <XCircle className="size-5" aria-hidden />
                </button>
              </div>
              {/* Duplicate warning — shown before anything is uploaded. */}
              {duplicate && (
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/8 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <CopyCheck className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-amber-200">
                        {dupReason === "title"
                          ? "A video with this title already exists"
                          : "This video looks like a duplicate"}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/80">
                        {dupReason === "title" ? "Matching title:" : "An identical file was uploaded as"}{" "}
                        <span className="font-semibold">“{duplicate.title}”</span> ({duplicate.status}) on{" "}
                        {new Date(duplicate.created_at).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                        .
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Link
                          to={`/admin/videos/${duplicate.id}`}
                          className="rounded-md border border-amber-400/40 px-2 py-1 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-400/10"
                        >
                          View existing video
                        </Link>
                        {!dupAcknowledged && (
                          <button
                            type="button"
                            onClick={() => setDupAcknowledged(true)}
                            className="rounded-md border border-white/15 px-2 py-1 text-[11px] font-semibold text-fog-200 transition hover:bg-white/10"
                          >
                            Upload anyway
                          </button>
                        )}
                        {dupAcknowledged && (
                          <span className="text-[11px] font-semibold text-emerald-300">
                            Duplicate acknowledged — upload enabled.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Automatic optimization — only offered when it would help. */}
              {!probing && encodePlan?.compress && (
                <div className="mt-4 rounded-xl border border-white/6 bg-ink-850 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <Wand2
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        optimizeEnabled ? "text-brand-400" : "text-fog-600"
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white">Automatic optimization</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-fog-500">
                        {!optimizeEnabled
                          ? "Off — the original file will be uploaded unchanged."
                          : encodePlan.reason}
                      </p>
                      {optimizeEnabled && encodePlan?.compress && (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fog-400">
                          <span>
                            {analysis?.height}p → <span className="text-brand-300">{encodePlan.targetHeight}p</span>
                          </span>
                          <span>{Math.round(encodePlan.videoBitrate / 1000)} kbps</span>
                          <span className="uppercase">{encodePlan.container}</span>
                          <span>
                            ≈ {fmtBytes(encodePlan.estimatedSize)}{" "}
                            <span className="text-emerald-400">
                              (−{Math.max(0, Math.round((1 - encodePlan.estimatedSize / file.size) * 100))}%)
                            </span>
                          </span>
                        </div>
                      )}
                      {!optimizeEnabled && (
                        <p className="mt-2 text-[11px] text-amber-300/90">
                          Uploading {fmtBytes(file.size)} — turning this on could save about{" "}
                          {Math.max(0, Math.round((1 - encodePlan.estimatedSize / file.size) * 100))}%.
                        </p>
                      )}
                    </div>
                    <Toggle
                      checked={optimizeEnabled}
                      onChange={setOptimizeEnabled}
                      label="Toggle automatic optimization"
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => pick(null)}>Choose different file</Btn>
                <Btn
                  variant="primary"
                  icon={ArrowRight}
                  onClick={startUpload}
                  disabled={probing || (Boolean(duplicate) && !dupAcknowledged)}
                >
                  {optimizeEnabled && encodePlan?.compress ? "Optimize & upload" : "Start upload"}
                </Btn>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Step 2a: optimizing ── */}
      {phase.step === "optimizing" && (
        <div className="rounded-3xl border border-white/8 bg-ink-900/60 p-6 md:p-8">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-medium text-white">
              <Wand2 className="size-4 text-brand-400" aria-hidden />
              Optimizing video…
            </p>
            <span className="text-xs font-semibold tabular-nums text-brand-300">{optimizePct}%</span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuenow={optimizePct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-[width] duration-300"
              style={{ width: `${optimizePct}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fog-500">
            <span>{encodePlan?.targetHeight}p · {Math.round((encodePlan?.videoBitrate ?? 0) / 1000)} kbps</span>
            <span>Target ≈ {fmtBytes(encodePlan?.estimatedSize ?? 0)}</span>
          </div>
          <div className="mt-6 flex justify-end">
            <Btn variant="ghost" onClick={cancelUpload}>Cancel</Btn>
          </div>
          <p className="mt-5 rounded-xl border border-white/6 bg-ink-850 p-3 text-[11px] leading-relaxed text-fog-600">
            The video is re-encoded locally in your browser before upload, so only the optimized file is
            transferred to storage. Keep this tab open until it completes.
          </p>
        </div>
      )}

      {/* ── Step 2: uploading ── */}
      {(phase.step === "uploading" || phase.step === "finishing") && (
        <div className="rounded-3xl border border-white/8 bg-ink-900/60 p-6 md:p-8">
          <div className="flex items-center justify-between">
            <p className="max-w-[60%] truncate text-sm font-medium text-white">{file?.name}</p>
            <span className="text-xs font-semibold tabular-nums text-brand-300">{pct}%</span>
          </div>

          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fog-500">
            <span>{fmtBytes(loaded)} / {file ? fmtBytes(file.size) : "—"}</span>
            <span>{speed ? `${fmtBytes(speed)}/s` : "—"}</span>
            <span>{eta ? `~${Math.ceil(eta)}s left` : ""}</span>
            {plan?.mode === "multipart" && <span>resumable multipart · {plan.parts.length} parts</span>}
          </div>

          {phase.step === "finishing" && (
            <p className="mt-4 flex items-center gap-2 text-sm text-amber-300">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Finalizing upload and processing media…
            </p>
          )}

          {phase.step === "uploading" && (
            <div className="mt-6 flex justify-end">
              <Btn variant="ghost" onClick={cancelUpload}>Cancel upload</Btn>
            </div>
          )}

          <p className="mt-5 rounded-xl border border-white/6 bg-ink-850 p-3 text-[11px] leading-relaxed text-fog-600">
            Files upload directly from your browser to Cloudflare R2 with temporary signed URLs — credentials never touch your device,
            and the video is still private. It becomes visible on EroBabe only after you publish it.
          </p>
        </div>
      )}

      {/* ── Step 3: metadata ── */}
      {phase.step === "details" && (
        <div className="space-y-5 rounded-3xl border border-white/8 bg-ink-900/60 p-6 animate-fade-up md:p-8">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
            <CheckCircle2 className="size-4.5" aria-hidden />
            Upload processed — it is currently a private draft.
          </div>

          <Field label="Title" hint="Shown across the site and in search.">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Give it a great title" />
          </Field>

          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="Short description shown on the watch page…" />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Thumbnail override (optional)" hint="A poster frame was auto-captured; replace it here if you like.">
              <label className="flex h-10.5 cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-ink-850 px-3.5 text-sm text-fog-400 transition hover:border-white/25">
                <ImagePlus className="size-4" aria-hidden />
                <span className="truncate">{thumbOverride ? "New thumbnail selected" : "Choose image…"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => setThumbOverride(String(reader.result));
                    reader.readAsDataURL(f);
                  }}
                />
              </label>
            </Field>
          </div>

          {/* FieldGroup (a div) — a <label> would swallow the button's click. */}
          <FieldGroup label="Tags">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {tagsAuto && tags.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-brand-500/12 px-2 py-1 text-[11px] font-semibold text-brand-300">
                  <Sparkles className="size-3" aria-hidden />
                  Auto-generated from title &amp; description
                </span>
              )}
              <button
                type="button"
                onClick={regenerateTags}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/4 px-2 py-1 text-[11px] font-medium text-fog-300 transition hover:border-brand-500/40 hover:text-white active:scale-95"
              >
                <RefreshCw className="size-3" aria-hidden />
                Regenerate
              </button>
            </div>
            <TagEditor
              tags={tags}
              onChange={(t) => {
                // Any manual edit hands control to the admin permanently.
                tagsTouched.current = true;
                setTagsAuto(false);
                setTags(t);
              }}
            />
          </FieldGroup>

          {(probe?.poster || thumbOverride) && (
            <div className="flex items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-fog-500">Preview</p>
              <img src={thumbOverride ?? probe?.poster ?? ""} alt="Thumbnail preview" className="aspect-video w-48 rounded-lg object-cover ring-1 ring-white/10" />
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-white/6 pt-5 sm:flex-row sm:justify-end">
            <Btn variant="ghost" icon={ArrowLeft} onClick={() => navigate("/admin/videos")}>Finish later</Btn>
            <Btn variant="outline" busy={saving} onClick={() => saveDraft(false)}>Save as draft</Btn>
            <Btn variant="primary" busy={saving} onClick={() => saveDraft(true)}>Save & publish</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
