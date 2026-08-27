import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CloudUpload, FileVideo, ImagePlus, Loader2, Wand2, XCircle,
} from "lucide-react";
import { api, type UploadPlan, type MultiPlan } from "./api";
import { fmtBytes, fmtDuration, probeVideoFile, uploadMissingParts, uploadToStorage, UploadCancelled } from "./uploader";
import {
  analyzeComplexity, analyzeVideo, compressionSupported, compressVideoAggressive, planEncode,
  CompressionCancelled, type EncodePlan, type VideoAnalysis,
} from "./compress";
import { Btn, Field, Input, PageHeader, Select, TagEditor, Textarea, useFetch } from "./ui";
import { toast } from "@/components/Feedback";
import { cn } from "@/lib/format";

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

type Phase =
  | { step: "select" }
  | { step: "optimizing" }
  | { step: "uploading" }
  | { step: "finishing" }
  | { step: "details" };

export default function UploadWizard() {
  const navigate = useNavigate();
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

  useEffect(() => () => abortRef.current?.abort(), []);

  const pick = (f: File | null) => {
    setError(null);
    setProbe(null);
    setThumbOverride(null);
    setAnalysis(null);
    setEncodePlan(null);
    setOptimized(null);
    setOptimizePct(0);
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
      if (!optimized && encodePlan?.compress) {
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

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Upload video" sub="Upload → Process → Draft → Preview → Publish. Nothing goes live until you publish it." />

      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-2 text-xs font-semibold">
        {["1 · File", "2 · Optimize & upload", "3 · Details"].map((label, i) => {
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
              pick(e.dataTransfer.files?.[0] ?? null);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 text-center transition md:p-16",
              drag ? "border-brand-500/60 bg-brand-500/8" : "border-white/12 bg-ink-900/40 hover:border-white/25"
            )}
          >
            <input
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
            <span className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/20 to-violet-600/20 text-brand-300 ring-1 ring-brand-500/30">
              <CloudUpload className="size-8" aria-hidden />
            </span>
            <p className="mt-5 text-base font-semibold text-white">Drag & drop your video</p>
            <p className="mt-1 text-sm text-fog-500">or click to browse — MP4, MOV, WEBM up to 2 GB</p>
            <p className="mt-3 text-[11px] text-fog-600">Large files upload directly to storage in resumable 16 MB chunks.</p>
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
              {/* Automatic optimization summary */}
              {!probing && (
                <div className="mt-4 rounded-xl border border-white/6 bg-ink-850 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <Wand2 className="mt-0.5 size-4 shrink-0 text-brand-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white">
                        {encodePlan?.compress ? "Automatic optimization" : "No optimization needed"}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-fog-500">
                        {encodePlan?.reason ??
                          (compressionSupported()
                            ? "Analyzing…"
                            : "This browser can't re-encode video — the original will be uploaded.")}
                      </p>
                      {encodePlan?.compress && (
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
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => pick(null)}>Choose different file</Btn>
                <Btn variant="primary" icon={ArrowRight} onClick={startUpload} disabled={probing}>
                  {encodePlan?.compress ? "Optimize & upload" : "Start upload"}
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

          <Field label="Tags">
            <TagEditor tags={tags} onChange={setTags} />
          </Field>

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
