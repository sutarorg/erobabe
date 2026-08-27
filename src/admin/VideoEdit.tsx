import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeft, BarChart3, CheckCircle2, Eye, EyeOff, Film, Globe, ImagePlus, Loader2, RefreshCw, Save, Trash2,
} from "lucide-react";
import { api } from "./api";
import { uploadToStorage, UploadCancelled, fmtBytes, fmtDuration, probeVideoFile } from "./uploader";
import {
  Btn, Confirm, EmptyBlock, Field, Input, PageHeader, Select, Spinner,
  StatusBadge, TagEditor, Textarea, Toggle, useFetch, fmtDateTime, fmtViews,
} from "./ui";
import { Player } from "@/components/Player";
import { toast } from "@/components/Feedback";
import { cn } from "@/lib/format";

function FlagRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-fog-600">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

export default function VideoEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const videoFetch = useFetch(() => api.video(id!), [id]);
  const catsFetch = useFetch(() => api.categories(), []);
  const categories = catsFetch.data?.categories ?? [];
  const video = videoFetch.data?.video ?? null;

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // replace-video state
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacePct, setReplacePct] = useState(0);
  const [replacing, setReplacing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (video) {
      setForm({
        title: video.title,
        slug: video.slug ?? "",
        description: video.description ?? "",
        categoryId: video.category_id,
        tags: video.tags ?? [],
        editorsPick: video.editors_pick,
        seoTitle: video.seo_title ?? "",
        seoDescription: video.seo_description ?? "",
      });
      setDirty(false);
    }
  }, [video]);

  if (videoFetch.loading) return <Spinner label="Loading video…" />;
  if (videoFetch.error || !video) {
    return <EmptyBlock icon={Film} title="Video not found" body={videoFetch.error ?? "It may have been deleted."} action={<Btn variant="subtle" onClick={() => navigate("/admin/videos")}>Back to videos</Btn>} />;
  }

  const set = (k: string, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patchVideo(video.id, form);
      toast("Changes saved");
      setDirty(false);
      videoFetch.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "info");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    setBusy(true);
    try {
      if (video.status === "published") {
        await api.unpublish(video.id);
        toast("Unpublished — hidden from the public site");
      } else {
        await api.publish(video.id);
        toast("Published — now live on EroBabe");
      }
      videoFetch.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed", "info");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.deleteVideo(video.id);
      toast("Video deleted");
      navigate("/admin/videos");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete failed", "info");
      setBusy(false);
    }
  };

  const startReplace = async () => {
    if (!replaceFile) return;
    setReplacing(true);
    setReplacePct(0);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const probe = await probeVideoFile(replaceFile);
      const plan = await api.createUpload({
        fileName: replaceFile.name,
        size: replaceFile.size,
        contentType: replaceFile.type || "video/mp4",
        replaceId: video.id,
        durationS: probe.durationS,
      });
      const etags = await uploadToStorage(replaceFile, plan, {
        signal: ac.signal,
        onProgress: (l, t) => setReplacePct(Math.min(100, Math.round((l / t) * 100))),
      });
      await api.completeUpload(plan.videoId, { parts: etags.length ? etags : undefined, durationS: probe.durationS });
      toast("Video replaced — processing finished");
      setReplaceFile(null);
      videoFetch.reload();
    } catch (e) {
      if (!(e instanceof UploadCancelled)) toast(e instanceof Error ? e.message : "Replace failed", "info");
    } finally {
      setReplacing(false);
    }
  };

  const playableUrl = video.hls_url ?? video.video_url;

  return (
    <div>
      <PageHeader
        title={video.title}
        sub={`Updated ${fmtDateTime(video.updated_at)} · ${fmtViews(video.views)} views`}
        actions={
          <>
            <Link to="/admin/videos" className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fog-400 hover:text-white">
              <ArrowLeft className="size-4" aria-hidden /> Videos
            </Link>
            {video.status === "published" && (
              <a href={`/video/${video.slug ?? video.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-3.5 text-sm font-medium text-fog-200 hover:text-white">
                <Eye className="size-4" aria-hidden /> View public page
              </a>
            )}
            <Link
              to={`/admin/videos/${video.id}/analytics`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-3.5 text-sm font-medium text-fog-200 hover:text-white"
            >
              <BarChart3 className="size-4" aria-hidden /> Analytics
            </Link>
            <Btn variant="primary" icon={Save} busy={saving} disabled={!dirty} onClick={save}>Save changes</Btn>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* ── Left: metadata ── */}
        <div className="space-y-6">
          <section className="space-y-5 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
            <h2 className="text-sm font-semibold text-white">Details</h2>
            <Field label="Title">
              <Input value={String(form.title ?? "")} onChange={(e) => set("title", e.target.value)} maxLength={120} />
            </Field>
            <Field
              label="Page URL (slug)"
              hint={
                video.status === "published"
                  ? "Locked while published so the indexed URL stays stable."
                  : "Auto-generated from the title; editable until the video is published."
              }
            >
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-850 px-3.5 py-2 text-sm">
                <span className="shrink-0 text-fog-600">/video/</span>
                <input
                  value={String(form.slug ?? video.slug ?? "")}
                  onChange={(e) => set("slug", e.target.value)}
                  disabled={video.status === "published"}
                  className="min-w-0 flex-1 bg-transparent text-white outline-none disabled:text-fog-400"
                  aria-label="Video slug"
                />
              </div>
            </Field>
            <Field label="Description">
              <Textarea value={String(form.description ?? "")} onChange={(e) => set("description", e.target.value)} maxLength={2000} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Category">
                <Select value={String(form.categoryId ?? "")} onChange={(e) => set("categoryId", e.target.value || null)}>
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Duration" hint={video.duration_s ? fmtDuration(video.duration_s) : "Unknown"}>
                <Input
                  type="number" min={0} max={86400}
                  value={video.duration_s ?? ""}
                  onChange={(e) => set("durationS", Number(e.target.value) || 0)}
                  aria-label="Duration in seconds"
                />
              </Field>
            </div>
            <Field label="Tags">
              <TagEditor tags={(form.tags as string[]) ?? []} onChange={(t) => set("tags", t)} />
            </Field>
          </section>

          <section className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
            <h2 className="text-sm font-semibold text-white">Curation</h2>
            <p className="mb-1 mt-1.5 text-xs leading-relaxed text-fog-500">
              Featured, Trending and Rising Now are chosen automatically by the ranking engine from live
              analytics — views, growth, watch time, completion and engagement. Marking a video as an
              Editor's pick adds it to the curated pool; the algorithm ranks that pool and shows the top 5.
            </p>
            <FlagRow
              label="Editor's pick"
              hint="Adds this video to the Editor's Picks candidate pool"
              checked={!!form.editorsPick}
              onChange={(v) => set("editorsPick", v)}
            />
          </section>

          <section className="space-y-5 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
            <h2 className="text-sm font-semibold text-white">SEO</h2>
            <Field label="SEO title" hint="Optional — falls back to the title.">
              <Input value={String(form.seoTitle ?? "")} onChange={(e) => set("seoTitle", e.target.value)} maxLength={150} />
            </Field>
            <Field label="SEO description">
              <Textarea value={String(form.seoDescription ?? "")} onChange={(e) => set("seoDescription", e.target.value)} maxLength={300} className="min-h-20" />
            </Field>
          </section>
        </div>

        {/* ── Right: status + media ── */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Status</h2>
              <StatusBadge status={video.status} />
            </div>
            <p className="mt-2 text-xs text-fog-600">
              {video.status === "published"
                ? `Live since ${fmtDateTime(video.published_at)}.`
                : "Not visible on the public site."}
            </p>
            <div className="mt-4 grid gap-2">
              {video.status === "published" ? (
                <Btn variant="outline" icon={EyeOff} busy={busy} onClick={togglePublish}>Unpublish</Btn>
              ) : (
                <Btn
                  variant="primary"
                  icon={Globe}
                  busy={busy}
                  disabled={["uploading", "processing"].includes(video.status)}
                  onClick={togglePublish}
                >
                  Publish now
                </Btn>
              )}
              {["uploading", "processing"].includes(video.status) && (
                <p className="flex items-center gap-2 text-xs text-amber-300">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Publishing unlocks once processing completes.
                </p>
              )}
              <Btn variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} className="!text-red-400 hover:!bg-red-500/10">
                Delete video
              </Btn>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/6 bg-ink-900/60">
            <div className="border-b border-white/6 p-5 pb-4">
              <h2 className="text-sm font-semibold text-white">Preview</h2>
            </div>
            <div className="bg-black">
              {playableUrl ? (
                <Player src={playableUrl} poster={video.thumbnail_url ?? undefined} title={video.title} />
              ) : (
                <div className="grid aspect-video place-items-center text-xs text-fog-600">No media attached yet</div>
              )}
            </div>
            <div className="space-y-1.5 p-5 text-xs text-fog-500">
              <p>Duration: <span className="text-fog-300">{fmtDuration(video.duration_s)}</span></p>
              <p>Size: <span className="text-fog-300">{fmtBytes(video.source_size)}</span></p>
              <p>Type: <span className="text-fog-300">{video.content_type ?? "—"}</span></p>
              {video.hls_url && <p className="flex items-center gap-1.5 text-emerald-400/90"><CheckCircle2 className="size-3.5" aria-hidden /> HLS stream available</p>}
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
            <h2 className="text-sm font-semibold text-white">Thumbnail</h2>
            <div className="relative aspect-video overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8">
              {video.thumbnail_url ? (
                <img src={video.thumbnail_url} alt="Current thumbnail" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <Film className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-fog-600" aria-hidden />
              )}
            </div>
            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 bg-ink-850 text-sm text-fog-300 transition hover:border-white/25 hover:text-white">
              <ImagePlus className="size-4" aria-hidden />
              Upload new thumbnail
              <input
                type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = async () => {
                    try {
                      await api.uploadMedia({ dataUrl: String(reader.result), kind: "thumbnail", refId: video.id });
                      toast("Thumbnail updated");
                      videoFetch.reload();
                    } catch (err) {
                      toast(err instanceof Error ? err.message : "Upload failed", "info");
                    }
                  };
                  reader.readAsDataURL(f);
                }}
              />
            </label>

            <h2 className="pt-2 text-sm font-semibold text-white">Replace video file</h2>
            {!replacing ? (
              <div className="space-y-2">
                <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 bg-ink-850 text-sm text-fog-300 transition hover:border-white/25 hover:text-white">
                  <RefreshCw className="size-4" aria-hidden />
                  {replaceFile ? replaceFile.name : "Choose replacement file…"}
                  <input type="file" accept="video/*" className="sr-only" onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)} />
                </label>
                {replaceFile && (
                  <div className="flex gap-2">
                    <Btn size="sm" variant="ghost" onClick={() => setReplaceFile(null)}>Cancel</Btn>
                    <Btn size="sm" variant="primary" className="flex-1" onClick={startReplace}>Upload replacement</Btn>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuenow={replacePct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={cn("h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-[width]")} style={{ width: `${replacePct}%` }} />
                </div>
                <p className="mt-2 text-xs text-fog-500">{replacePct}% — replacing file…</p>
              </div>
            )}
          </section>
        </div>
      </div>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        title="Delete video?"
        body={`“${video.title}” and its stored media will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete permanently"
        busy={busy}
      />
    </div>
  );
}
