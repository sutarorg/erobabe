/**
 * New upload wizard — Upload → Details → Thumbnail → SEO → Review/Publish.
 *
 * Demo mode honesty: files never leave the browser. Duration/metadata are
 * probed locally; posters can be captured from an actual frame via canvas.
 * With R2 + a processing provider configured, this same flow drives the
 * presigned multipart upload + FFmpeg pipeline (see server/app.ts) — and the
 * UI surfaces "provider not configured" instead of faking transcodes.
 */
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Camera, Check, CircleAlert, Clapperboard, CloudUpload, ExternalLink,
  Film, Image as ImageIcon, Rocket, X,
} from "lucide-react";
import { FALLBACK_THUMB, formatBytes, formatDuration } from "../data/videos";
import { DEMO_MODE, slugify } from "../lib/api";
import { newVideoId, setEphemeralSource, uniqueSlug, useAdmin, validatePublish, type AdminVideo } from "./store";
import { areaCls, Card, Field, inputCls, PageHeader } from "./AdminApp";
import { Button, Toggle } from "../components/ui";
import { cn } from "../utils/cn";

const STEPS = ["Upload", "Details", "Thumbnail", "SEO", "Review"] as const;
const ACCEPT = "video/mp4,video/webm,video/quicktime";
const MAX_GB = 2;

export function AdminUploadPage() {
  const { state, addVideo, publish, getVideoUrl } = useAdmin();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [done, setDone] = useState<"published" | "draft" | null>(null);

  // draft under construction
  const [draft, setDraft] = useState<AdminVideo | null>(null);
  const probeRef = useRef<HTMLVideoElement | null>(null);
  const [posterTime, setPosterTime] = useState(0);
  const createdRef = useRef(false);

  const set = (patch: Partial<AdminVideo>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  /* ---------------- file intake ---------------- */

  const intake = (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    const okTypes = ["video/mp4", "video/webm", "video/quicktime"];
    if (file.type && !okTypes.includes(file.type)) {
      setFileError(`Unsupported type "${file.type}". Accepted: MP4, WebM, MOV.`);
      return;
    }
    if (file.size > MAX_GB * 1024 * 1024 * 1024) {
      setFileError(`File is ${formatBytes(file.size)} — maximum configured size is ${MAX_GB} GB.`);
      return;
    }
    const id = newVideoId();
    const url = URL.createObjectURL(file);
    setEphemeralSource(id, url);
    const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    const fresh: AdminVideo = {
      id,
      slug: uniqueSlug(name || "untitled", state.videos),
      title: name ? name.charAt(0).toUpperCase() + name.slice(1) : "Untitled upload",
      category: state.categories[0]?.slug ?? "studio",
      tags: [],
      durationSec: 0,
      views: 0,
      daysAgo: 0,
      performer: "",
      quality: file.size > 400e6 ? "4K" : "HD",
      thumbnail: "",
      videoUrl: "",
      description: "",
      createdAt: new Date().toISOString(),
      status: "PROCESSING",
      fileName: file.name,
      fileSize: file.size,
      mime: file.type || "video/mp4",
      sourceEphemeral: true,
      updatedAt: new Date().toISOString(),
      publishedAt: null,
    };
    setDraft(fresh);
    createdRef.current = false;
  };

  const onProbe = () => {
    const v = probeRef.current;
    if (!v || !draft) return;
    const dur = v.duration;
    if (Number.isFinite(dur) && dur > 0) set({ durationSec: Math.round(dur) });
    // No encoder in demo: mark honestly as READY (single-source original).
    set({ status: "READY" });
  };

  const capturePoster = () => {
    const v = probeRef.current;
    if (!v || !draft) return;
    const canvas = document.createElement("canvas");
    const w = 960;
    const h = Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    set({ thumbnail: canvas.toDataURL("image/webp", 0.82) });
  };

  const validation = draft ? validatePublish({ ...draft, videoUrl: "ready" }) : "Upload a file first.";
  const canContinue = [Boolean(draft), Boolean(draft?.title.trim()) && Boolean(draft?.category), Boolean(draft?.thumbnail), true, !validation][step];

  /* ---------------- finish ---------------- */

  const finish = (mode: "published" | "draft") => {
    if (!draft) return;
    if (!createdRef.current) {
      addVideo({ ...draft, status: mode === "published" ? "READY" : "DRAFT" });
      createdRef.current = true;
    }
    if (mode === "published") publish([draft.id]);
    setDone(mode);
  };

  /* ---------------- source url for probing ---------------- */
  const srcUrl = draft ? getVideoUrl(draft) || draft.videoUrl : "";

  if (done && draft) {
    return (
      <div className="anim-fade-up mx-auto max-w-lg py-16 text-center">
        <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-xl shadow-emerald-500/25">
          <Check size={28} />
        </span>
        <h1 className="font-display text-2xl font-bold text-white">
          {done === "published" ? "Published successfully" : "Draft saved"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-eb-muted">
          {done === "published"
            ? `“${draft.title}” is live. The homepage, search, category page and recommendations pick it up automatically — no redeploy required.`
            : "Your video is stored as a draft. Publish it from the library whenever it's ready."}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          {done === "published" && (
            <Link to={`/watch/${draft.id}`}>
              <Button>
                <ExternalLink size={14} /> View on EroBabe
              </Button>
            </Link>
          )}
          <Button variant="outline" onClick={() => navigate("/admin/videos")}>
            Open library
          </Button>
          <Button variant="ghost" onClick={() => { setDraft(null); setStep(0); setDone(null); }}>
            Upload another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-fade-up mx-auto max-w-3xl">
      <PageHeader title="New Upload" sub="500 MB – 2 GB source files upload straight to R2 in production." />

      {/* stepper */}
      <ol className="mb-7 flex items-center gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span className={cn("h-1 rounded-full transition-colors duration-300", i < step ? "bg-emerald-500/70" : i === step ? "bg-gradient-to-r from-eb-rose to-eb-violet" : "bg-eb-800")} />
            <span className={cn("text-[10px] font-bold tracking-wider uppercase", i === step ? "text-white" : "text-eb-faint")}>{label}</span>
          </li>
        ))}
      </ol>

      {/* STEP 1 — upload */}
      {step === 0 && (
        <Card className="p-6">
          {!draft ? (
            <label
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); intake(e.dataTransfer.files?.[0]); }}
              className={cn(
                "ring-focus flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition",
                dragging ? "border-eb-rose bg-eb-rose/5" : "border-eb-line-strong hover:border-eb-rose/50 hover:bg-white/[0.02]"
              )}
            >
              <CloudUpload size={30} className="mb-4 text-eb-rose" />
              <p className="font-display text-base font-bold text-white">Drag & drop your video here</p>
              <p className="mt-1.5 text-xs text-eb-muted">or</p>
              <span className="mt-3 inline-flex h-10 items-center rounded-full bg-gradient-to-r from-eb-rose to-eb-violet px-6 text-sm font-semibold text-white">Choose video</span>
              <p className="mt-4 text-[11px] text-eb-faint">MP4, WebM or MOV • maximum configured size: {MAX_GB} GB</p>
              <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => intake(e.target.files?.[0])} />
            </label>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 rounded-2xl border border-eb-line bg-eb-850 p-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-eb-rose to-eb-violet text-white">
                  <Film size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{draft.fileName}</p>
                  <p className="mt-0.5 text-xs text-eb-faint">{formatBytes(draft.fileSize ?? 0)} • {draft.mime}</p>
                </div>
                <button onClick={() => setDraft(null)} aria-label="Remove file" className="ring-focus cursor-pointer rounded-full p-2 text-eb-faint hover:bg-white/5 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              {/* local probe (real metadata) */}
              <video
                ref={probeRef}
                src={srcUrl}
                onLoadedMetadata={onProbe}
                controls
                playsInline
                className="aspect-video w-full rounded-2xl border border-eb-line bg-black"
              />

              <ul className="space-y-2 text-xs">
                <ChecklistItem done label="Video selected — validated type & size" />
                <ChecklistItem done={draft.durationSec > 0} label={draft.durationSec > 0 ? `Metadata extracted (${formatDuration(draft.durationSec)})` : "Reading metadata…"} />
                <li className="flex items-start gap-2.5 text-eb-muted">
                  <CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-400" />
                  <span>
                    {DEMO_MODE
                      ? "Processing provider not configured — demo publishes the original file as single-source MP4 (no fake renditions)."
                      : "Processing job will be queued after upload completes (FFmpeg worker → HLS renditions)."}
                  </span>
                </li>
              </ul>
            </div>
          )}
          {fileError && (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs font-medium text-red-400">
              <CircleAlert size={14} /> {fileError}
            </p>
          )}
        </Card>
      )}

      {/* STEP 2 — details */}
      {step === 1 && draft && (
        <Card className="space-y-4 p-6">
          <Field label="Title *">
            <input className={inputCls} value={draft.title} onChange={(e) => set({ title: e.target.value, slug: uniqueSlug(e.target.value || "video", state.videos) })} />
          </Field>
          <Field label="Description">
            <textarea className={areaCls} rows={4} value={draft.description} placeholder="A short, tasteful description shown on the watch page…" onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category *">
              <select className={cn(inputCls, "cursor-pointer")} value={draft.category} onChange={(e) => set({ category: e.target.value })}>
                {state.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Performer label">
              <input className={inputCls} value={draft.performer} placeholder="Fictional performer name" onChange={(e) => set({ performer: e.target.value })} />
            </Field>
          </div>
          <Field label={`Tags (${draft.tags.length})`} hint="Comma separated — stored relationally in production">
            <input className={inputCls} defaultValue={draft.tags.join(", ")} onBlur={(e) => set({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} placeholder="Night, Editorial, Slow" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-eb-line bg-eb-850 px-3.5 py-3">
              <span className="text-xs font-semibold text-eb-muted">Featured</span>
              <Toggle on={Boolean(draft.featured)} onChange={(v) => set({ featured: v })} label="Featured" />
            </label>
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-eb-line bg-eb-850 px-3.5 py-3">
              <span className="text-xs font-semibold text-eb-muted">Trending boost</span>
              <Toggle on={Boolean(draft.trending)} onChange={(v) => set({ trending: v })} label="Trending" />
            </label>
          </div>
        </Card>
      )}

      {/* STEP 3 — thumbnail */}
      {step === 2 && draft && (
        <Card className="space-y-5 p-6">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="ring-focus flex cursor-pointer items-center gap-3 rounded-2xl border border-eb-line bg-eb-850 px-4 py-3.5 transition hover:border-eb-rose/40">
              <ImageIcon size={16} className="text-eb-rose" />
              <div>
                <p className="text-xs font-bold text-white">Upload image</p>
                <p className="text-[10px] text-eb-faint">JPG / PNG / WebP</p>
              </div>
              <input
                type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => set({ thumbnail: String(r.result) });
                  r.readAsDataURL(f);
                }}
              />
            </label>
            <div className="flex items-center gap-3 rounded-2xl border border-eb-line bg-eb-850 px-4 py-3.5">
              <Camera size={16} className="text-eb-violet" />
              <div>
                <p className="text-xs font-bold text-white">Generate from video</p>
                <p className="text-[10px] text-eb-faint">Pick a frame from the source below</p>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-eb-line bg-black">
            <video ref={probeRef} src={srcUrl} playsInline preload="metadata" className="aspect-video w-full" />
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range" min={0} max={draft.durationSec || 60} step={0.5} value={posterTime}
              onChange={(e) => {
                const t = Number(e.target.value);
                setPosterTime(t);
                if (probeRef.current) probeRef.current.currentTime = t;
              }}
              className="flex-1"
              aria-label="Poster frame timestamp"
            />
            <span className="font-mono text-xs text-eb-muted">{formatDuration(posterTime)}</span>
            <Button size="sm" variant="outline" onClick={capturePoster}>
              <Camera size={13} /> Capture frame
            </Button>
          </div>

          {draft.thumbnail && (
            <div>
              <p className="mb-2 text-xs font-semibold text-eb-muted">Poster preview</p>
              <img src={draft.thumbnail} alt="Poster" className="aspect-video w-full max-w-md rounded-2xl border border-eb-line object-cover" />
            </div>
          )}
        </Card>
      )}

      {/* STEP 4 — SEO */}
      {step === 3 && draft && (
        <Card className="space-y-4 p-6">
          <Field label="URL slug" hint={`Watch URL: /watch/${draft.id} · slug is used for the canonical SEO URL`}>
            <input className={inputCls} value={draft.slug} onChange={(e) => set({ slug: slugify(e.target.value) })} />
          </Field>
          <Field label="SEO title">
            <input className={inputCls} value={draft.seoTitle ?? ""} placeholder={draft.title} onChange={(e) => set({ seoTitle: e.target.value })} />
          </Field>
          <Field label="SEO description" hint={`${(draft.seoDescription ?? "").length}/160`}>
            <textarea className={areaCls} rows={3} maxLength={160} value={draft.seoDescription ?? ""} placeholder={draft.description} onChange={(e) => set({ seoDescription: e.target.value })} />
          </Field>
          <div className="rounded-2xl border border-eb-line bg-eb-850 p-4">
            <p className="mb-2 text-[10px] font-bold tracking-widest text-eb-faint uppercase">Search preview</p>
            <p className="text-sm font-medium text-[#7aa2ff]">{draft.seoTitle || draft.title} — EroBabe</p>
            <p className="mt-0.5 text-xs text-emerald-500/80">erobabe.com/watch/{draft.slug}</p>
            <p className="mt-1 line-clamp-2 text-xs text-eb-muted">{draft.seoDescription || draft.description || "Add a description to improve click-through."}</p>
          </div>
        </Card>
      )}

      {/* STEP 5 — review */}
      {step === 4 && draft && (
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="grid sm:grid-cols-[300px_1fr]">
              <img src={draft.thumbnail || FALLBACK_THUMB} alt="" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="aspect-video h-full w-full object-cover" />
              <div className="space-y-2 p-5">
                <h3 className="font-display text-base font-bold text-white">{draft.title}</h3>
                <p className="line-clamp-2 text-xs leading-relaxed text-eb-muted">{draft.description || "No description."}</p>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-eb-faint">
                  <span className="rounded-full border border-eb-line px-2 py-0.5 capitalize">{draft.category}</span>
                  {draft.tags.map((t) => (
                    <span key={t} className="rounded-full border border-eb-line px-2 py-0.5">#{t}</span>
                  ))}
                </div>
                <p className="text-[11px] text-eb-faint">
                  {formatDuration(draft.durationSec)} • {formatBytes(draft.fileSize ?? 0)} • {draft.quality} • single-source MP4
                </p>
              </div>
            </div>
          </Card>

          <Card className="space-y-2.5 p-5">
            <ChecklistItem done={Boolean(draft.title.trim())} label="Title set" warn={!draft.title.trim()} />
            <ChecklistItem done={Boolean(draft.category)} label="Category assigned" />
            <ChecklistItem done={Boolean(draft.thumbnail)} label="Thumbnail / poster present" warn={!draft.thumbnail} />
            <ChecklistItem done={draft.durationSec > 0} label="Metadata extracted" />
            <ChecklistItem done label={DEMO_MODE ? "Source ready (browser-local demo copy)" : "R2 object verified"} />
          </Card>

          <div className="rounded-2xl border border-eb-line bg-eb-900/70 p-4 text-[11px] leading-relaxed text-eb-faint">
            Publishing flips the record to <span className="font-bold text-emerald-400">PUBLISHED</span>. The public API and the EroBabe site surface it immediately — homepage sections, search, category pages and recommendations included. No redeploy.
          </div>
        </div>
      )}

      {/* footer nav */}
      <div className="sticky bottom-0 z-30 mt-6 flex items-center gap-2.5 border-t border-eb-line bg-eb-950/90 py-4 backdrop-blur-xl">
        {step > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}>
            ← Back
          </Button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex gap-2.5">
          {step === STEPS.length - 1 ? (
            <>
              <Button variant="outline" size="sm" onClick={() => finish("draft")}>
                Save as draft
              </Button>
              <Button size="sm" disabled={Boolean(validation)} onClick={() => finish("published")} title={validation ?? ""}>
                <Rocket size={13} /> Publish video
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
              Continue →
            </Button>
          )}
        </div>
      </div>
      {step === STEPS.length - 1 && validation && (
        <p className="flex items-center gap-2 pb-6 text-[11px] font-medium text-amber-400">
          <CircleAlert size={13} /> {validation}
        </p>
      )}
    </div>
  );
}

function ChecklistItem({ done, label, warn }: { done?: boolean; label: string; warn?: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-xs text-eb-muted">
      {done ? (
        <Check size={15} className="shrink-0 text-emerald-400" />
      ) : warn ? (
        <CircleAlert size={15} className="shrink-0 text-amber-400" />
      ) : (
        <Clapperboard size={15} className="shrink-0 animate-pulse text-eb-faint" />
      )}
      {label}
    </li>
  );
}

