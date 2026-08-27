/**
 * Admin video library (table, filters, bulk ops, pagination) and the
 * full video editor (metadata, thumbnail, SEO, publish workflow, delete).
 */
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert,
  ExternalLink, Eye, Film, Image as ImageIcon, Pencil, Rocket, Search,
  Star, Trash2, Upload,
} from "lucide-react";
import { FALLBACK_THUMB, formatBytes, formatDuration, formatViews } from "../data/videos";
import { slugify } from "../lib/api";
import { useAdmin, validatePublish, type AdminVideo } from "./store";
import { areaCls, Card, Field, inputCls, PageHeader } from "./AdminApp";
import { Button, Chip, Modal, StatusPill, Toggle } from "../components/ui";
import { cn } from "../utils/cn";

const PAGE_SIZE = 10;
const STATUS_FILTERS = ["ALL", "PUBLISHED", "DRAFT", "READY", "PROCESSING", "UNPUBLISHED", "FAILED"] as const;

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

export function AdminVideosPage() {
  const { state, publish, unpublish, deleteVideos, bulkFlag, log } = useAdmin();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [sort, setSort] = useState<"updated" | "views" | "title">("updated");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = [...state.videos];
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter((v) =>
        [v.title, v.id, v.slug, v.category, ...v.tags].join(" ").toLowerCase().includes(q)
      );
    if (status !== "ALL") list = list.filter((v) => v.status === status);
    list.sort((a, b) =>
      sort === "views" ? b.views - a.views : sort === "title" ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt)
    );
    return list;
  }, [state.videos, query, status, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allOnPage = pageItems.length > 0 && pageItems.every((v) => selected.has(v.id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allOnPage) pageItems.forEach((v) => next.delete(v.id));
    else pageItems.forEach((v) => next.add(v.id));
    setSelected(next);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const doPublish = (ids: string[]) => {
    const res = publish(ids);
    const errs = Object.entries(res.errors);
    if (errs.length) flash(`Blocked: ${errs.length} video(s) missing required fields (${state.videos.find(v => v.id === errs[0][0])?.title ?? ""}: ${errs[0][1]})`);
    else flash(`Published ${ids.length} video(s) — live on EroBabe now.`);
    setSelected(new Set());
  };

  const doDelete = () => {
    const ids = [...selected];
    deleteVideos(ids);
    setConfirmDelete(false);
    setSelected(new Set());
    flash(`Deleted ${ids.length} video(s) along with their stored objects (demo purge).`);
  };

  return (
    <div className="anim-fade-up space-y-5">
      <PageHeader
        title="Video Library"
        sub={`${state.videos.length} videos in the CMS`}
        actions={
          <Link to="/admin/videos/new">
            <Button size="sm">
              <Upload size={13} /> New upload
            </Button>
          </Link>
        }
      />

      {notice && (
        <div className="anim-fade flex items-center gap-2 rounded-xl border border-eb-line bg-eb-850 px-4 py-3 text-xs font-medium text-eb-text">
          <Check size={14} className="shrink-0 text-emerald-400" /> {notice}
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex h-10 min-w-52 flex-1 items-center gap-2 rounded-xl border border-eb-line bg-eb-850 px-3.5">
          <Search size={14} className="shrink-0 text-eb-faint" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
              if (!e.target.value) setParams({}, { replace: true });
            }}
            placeholder="Filter by title, id, slug, tag…"
            className="h-full w-full bg-transparent text-sm text-white outline-none placeholder:text-eb-faint"
          />
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {STATUS_FILTERS.map((s) => (
            <Chip key={s} active={status === s} onClick={() => { setStatus(s); setPage(1); }}>
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </Chip>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort videos" className={cn(inputCls, "h-9 w-auto cursor-pointer text-xs")}>
          <option value="updated">Recently updated</option>
          <option value="views">Most viewed</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="anim-fade no-scrollbar sticky top-[72px] z-30 flex items-center gap-2 overflow-x-auto rounded-xl border border-eb-rose/25 bg-eb-850/95 px-4 py-2.5 backdrop-blur-xl">
          <span className="shrink-0 text-xs font-bold text-white">{selected.size} selected</span>
          <BulkBtn label="Publish" onClick={() => doPublish([...selected])} />
          <BulkBtn label="Unpublish" onClick={() => { unpublish([...selected]); setSelected(new Set()); flash("Unpublished — hidden from the public site."); }} />
          <BulkBtn label="Feature" onClick={() => { bulkFlag([...selected], "featured", true); setSelected(new Set()); }} />
          <BulkBtn label="Unfeature" onClick={() => { bulkFlag([...selected], "featured", false); setSelected(new Set()); }} />
          <BulkBtn label="Trending" onClick={() => { bulkFlag([...selected], "trending", true); setSelected(new Set()); log("Marked trending", "video", [...selected].join(",")); }} />
          <BulkBtn label="Delete" danger onClick={() => setConfirmDelete(true)} />
          <button onClick={() => setSelected(new Set())} className="ml-auto shrink-0 cursor-pointer text-xs font-semibold text-eb-faint hover:text-white">
            Clear
          </button>
        </div>
      )}

      {/* table (desktop) */}
      <Card className="hidden overflow-hidden lg:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-eb-line text-[10px] tracking-widest text-eb-faint uppercase">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all on page" className="cursor-pointer" />
              </th>
              <th className="px-3 py-3">Video</th>
              <th className="px-3 py-3">Category</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-right">Views</th>
              <th className="px-3 py-3">Duration</th>
              <th className="px-3 py-3">Updated</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-eb-line">
            {pageItems.map((v) => (
              <tr key={v.id} className={cn("transition hover:bg-white/[0.02]", selected.has(v.id) && "bg-eb-rose/[0.04]")}>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Select ${v.title}`} className="cursor-pointer" />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-eb-800">
                      <img src={v.thumbnail || FALLBACK_THUMB} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="h-full w-full object-cover" />
                    </span>
                    <div className="min-w-0">
                      <p className="max-w-64 truncate font-semibold text-eb-text">{v.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-eb-faint">/{v.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-eb-muted capitalize">{v.category}</td>
                <td className="px-3 py-3">
                  <StatusPill status={v.status} />
                </td>
                <td className="px-3 py-3 text-right text-xs text-eb-muted">{formatViews(v.views)}</td>
                <td className="px-3 py-3 text-xs text-eb-muted">{formatDuration(v.durationSec)}</td>
                <td className="px-3 py-3 text-xs text-eb-faint">{v.updatedAt.slice(0, 10)}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {v.status === "PUBLISHED" && (
                      <IconBtn title="View on site" to={`/watch/${v.id}`}>
                        <Eye size={14} />
                      </IconBtn>
                    )}
                    <IconBtn title="Edit" to={`/admin/videos/${v.id}/edit`}>
                      <Pencil size={14} />
                    </IconBtn>
                    {v.status !== "PUBLISHED" && (
                      <IconBtn title="Publish now" onClick={() => doPublish([v.id])}>
                        <Rocket size={14} />
                      </IconBtn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pageItems.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Film size={24} className="text-eb-faint" />
            <p className="text-sm text-eb-muted">No videos match this filter.</p>
          </div>
        )}
      </Card>

      {/* cards (mobile) */}
      <div className="grid gap-3 lg:hidden">
        {pageItems.map((v) => (
          <Card key={v.id} className={cn("p-3", selected.has(v.id) && "border-eb-rose/40")}>
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Select ${v.title}`} className="mt-2 cursor-pointer" />
              <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-eb-800">
                <img src={v.thumbnail || FALLBACK_THUMB} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="h-full w-full object-cover" />
                <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white">{formatDuration(v.durationSec)}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-eb-text">{v.title}</p>
                <p className="mt-0.5 text-[11px] text-eb-faint capitalize">{v.category} • {formatViews(v.views)} views</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <StatusPill status={v.status} />
                  <Link to={`/admin/videos/${v.id}/edit`} className="text-[11px] font-semibold text-eb-rose-soft">Edit</Link>
                  {v.status !== "PUBLISHED" && (
                    <button onClick={() => doPublish([v.id])} className="cursor-pointer text-[11px] font-semibold text-emerald-400">Publish</button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-eb-faint">
          Page {page} of {pages} • {filtered.length} result(s)
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={13} /> Prev
          </Button>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight size={13} />
          </Button>
        </div>
      </div>

      {/* delete confirmation */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${selected.size} video(s)?`}>
        <p className="text-sm leading-relaxed text-eb-muted">This permanently removes, for each selected video:</p>
        <ul className="mt-3 space-y-1.5 text-xs text-eb-muted">
          {["Database record", "Original upload (R2 original/)", "Encoded renditions + HLS (encoded/)", "Thumbnail, poster and preview"].map((x) => (
            <li key={x} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-eb-rose" /> {x}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={doDelete}>
            <Trash2 size={13} /> Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function BulkBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 cursor-pointer rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition",
        danger ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20" : "border-eb-line bg-eb-800 text-eb-muted hover:border-white/25 hover:text-white"
      )}
    >
      {label}
    </button>
  );
}

function IconBtn({ children, title, to, onClick }: { children: React.ReactNode; title: string; to?: string; onClick?: () => void }) {
  const cls = "ring-focus flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-eb-faint transition hover:bg-white/5 hover:text-white";
  if (to)
    return (
      <Link to={to} title={title} aria-label={title} className={cls}>
        {children}
      </Link>
    );
  return (
    <button onClick={onClick} title={title} aria-label={title} className={cls}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function AdminVideoEditorPage() {
  const { id = "" } = useParams();
  const { state, updateVideo, publish, unpublish, deleteVideos, getVideoUrl } = useAdmin();
  const navigate = useNavigate();
  const video = state.videos.find((v) => v.id === id);
  const [draft, setDraft] = useState<AdminVideo | null>(video ?? null);
  const [saved, setSaved] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!video || !draft) {
    return (
      <div className="py-24 text-center">
        <CircleAlert size={28} className="mx-auto mb-3 text-eb-rose" />
        <p className="text-sm text-eb-muted">Video not found — it may have been deleted.</p>
        <Link to="/admin/videos" className="mt-4 inline-block text-xs font-semibold text-eb-rose-soft">← Back to library</Link>
      </div>
    );
  }

  const set = (patch: Partial<AdminVideo>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setSaved(false);
  };

  const validationError = validatePublish({ ...draft, videoUrl: draft.videoUrl || getVideoUrl(draft) });

  const save = () => {
    updateVideo(video.id, draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const doPublish = () => {
    save();
    const res = publish([video.id]);
    setPubError(res.errors[video.id] ?? null);
  };

  const onThumbFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ thumbnail: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="anim-fade-up mx-auto max-w-5xl">
      <button onClick={() => navigate(-1)} className="mb-4 flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-eb-faint transition hover:text-white">
        <ArrowLeft size={13} /> Back
      </button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusPill status={draft.status} />
          <h1 className="font-display truncate text-lg font-bold text-white sm:text-xl">{draft.title || "Untitled"}</h1>
        </div>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {draft.status !== "PUBLISHED" ? (
            <Button size="sm" onClick={doPublish}>
              <Rocket size={13} /> Publish
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { unpublish([video.id]); setDraft((d) => d && { ...d, status: "UNPUBLISHED" }); }}>
              Unpublish
            </Button>
          )}
          <Button size="sm" variant={saved ? "glass" : "primary"} onClick={save}>
            {saved ? <Check size={13} className="text-emerald-400" /> : null} {saved ? "Saved" : "Save changes"}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={13} /> Delete
          </Button>
        </div>
      </div>

      {pubError && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs font-medium text-red-400">
          <CircleAlert size={14} /> {pubError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* left: metadata */}
        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <h2 className="font-display text-sm font-bold text-white">Details</h2>
            <Field label="Title *">
              <input className={inputCls} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Description">
              <textarea className={areaCls} rows={4} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
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
                <input className={inputCls} value={draft.performer} onChange={(e) => set({ performer: e.target.value })} />
              </Field>
            </div>
            <Field label={`Tags (${draft.tags.length})`} hint="Comma separated">
              <input
                className={inputCls}
                defaultValue={draft.tags.join(", ")}
                onBlur={(e) => set({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-eb-line bg-eb-850 px-3.5 py-3">
                <span className="flex items-center gap-2 text-xs font-semibold text-eb-muted"><Star size={13} /> Featured</span>
                <Toggle on={Boolean(draft.featured)} onChange={(v) => set({ featured: v })} label="Featured" />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-eb-line bg-eb-850 px-3.5 py-3">
                <span className="flex items-center gap-2 text-xs font-semibold text-eb-muted"><Rocket size={13} /> Trending</span>
                <Toggle on={Boolean(draft.trending)} onChange={(v) => set({ trending: v })} label="Trending" />
              </label>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-display text-sm font-bold text-white">SEO</h2>
            <Field label="Slug" hint={`Public URL: /watch/${video.id} — slug: ${draft.slug}`}>
              <input className={inputCls} value={draft.slug} onChange={(e) => set({ slug: slugify(e.target.value) })} />
            </Field>
            <Field label="SEO title">
              <input className={inputCls} value={draft.seoTitle ?? ""} onChange={(e) => set({ seoTitle: e.target.value })} />
            </Field>
            <Field label="SEO description">
              <textarea className={areaCls} rows={3} value={draft.seoDescription ?? ""} onChange={(e) => set({ seoDescription: e.target.value })} />
            </Field>
          </Card>
        </div>

        {/* right: preview + thumbnail + source */}
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="aspect-video bg-black">
              {draft.videoUrl || getVideoUrl(draft) ? (
                <video key={getVideoUrl(draft) || draft.videoUrl} src={getVideoUrl(draft) || draft.videoUrl} poster={draft.thumbnail || FALLBACK_THUMB} controls playsInline preload="metadata" className="h-full w-full" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <Film size={22} className="text-eb-rose" />
                  <p className="text-xs text-eb-muted">Source expired (demo browser upload). Replace the file below.</p>
                </div>
              )}
            </div>
            <div className="space-y-1.5 p-4 text-[11px] text-eb-faint">
              <p>ID: <span className="text-eb-muted">{video.id}</span></p>
              <p>File: <span className="text-eb-muted">{draft.fileName ?? "—"}</span> • {formatBytes(draft.fileSize ?? 0)}</p>
              <p>Duration: <span className="text-eb-muted">{formatDuration(draft.durationSec)}</span> • Quality: <span className="text-eb-muted">{draft.quality}</span></p>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-display flex items-center gap-2 text-sm font-bold text-white"><ImageIcon size={14} /> Thumbnail</h2>
            <img src={draft.thumbnail || FALLBACK_THUMB} alt="Thumbnail preview" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="aspect-video w-full rounded-xl border border-eb-line object-cover" />
            <label className="ring-focus flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-eb-line-strong text-xs font-semibold text-eb-muted transition hover:border-eb-rose/50 hover:text-white">
              <Upload size={13} /> Replace thumbnail image
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onThumbFile(e.target.files?.[0])} />
            </label>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-display text-sm font-bold text-white">Source file</h2>
            <label className="ring-focus flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-eb-line-strong text-xs font-semibold text-eb-muted transition hover:border-eb-rose/50 hover:text-white">
              <Upload size={13} /> Replace video (demo: local preview)
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const url = URL.createObjectURL(f);
                  import("./store").then((m) => m.setEphemeralSource(video.id, url));
                  set({ fileName: f.name, fileSize: f.size, mime: f.type });
                  updateVideo(video.id, { fileName: f.name, fileSize: f.size, mime: f.type, sourceEphemeral: true });
                }}
              />
            </label>
            <p className="text-[11px] leading-relaxed text-eb-faint">
              Production uploads go browser → R2 via presigned multipart URLs. Demo mode keeps the file in this browser tab only.
            </p>
          </Card>

          {draft.status === "PUBLISHED" && (
            <Link to={`/watch/${video.id}`} className="ring-focus flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 py-3 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/15">
              <ExternalLink size={13} /> Live on EroBabe — view watch page
            </Link>
          )}

          {validationError && draft.status !== "PUBLISHED" && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3.5 py-3 text-[11px] leading-relaxed text-amber-300/90">
              <CircleAlert size={13} className="mt-0.5 shrink-0" /> Before publishing: {validationError}
            </p>
          )}
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this video?">
        <p className="text-sm text-eb-muted">This removes the database record plus the original file, encoded renditions and thumbnail from storage.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={() => { deleteVideos([video.id]); navigate("/admin/videos"); }}>
            <Trash2 size={13} /> Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}
