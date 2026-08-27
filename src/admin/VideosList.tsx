import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Film, SquarePen, Trash2, UploadCloud, Globe, EyeOff } from "lucide-react";
import { api, type AdminVideo, type BulkAction } from "./api";
import {
  Btn, BtnLink, Confirm, EmptyBlock, Field, PageHeader, Pagination, SearchInput,
  Select, Spinner, StatusBadge, useDebounced, useFetch, fmtDur, fmtDateTime, fmtViews,
} from "./ui";
import { fmtBytes } from "./uploader";
import { toast } from "@/components/Feedback";
import { cn } from "@/lib/format";

function Thumb({ video, className }: { video: AdminVideo; className?: string }) {
  return (
    <div className={cn("relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-ink-800 ring-1 ring-white/8", className)}>
      {video.thumbnail_url ? (
        <img src={video.thumbnail_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Film className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-fog-600" aria-hidden />
      )}
    </div>
  );
}

export default function VideosList() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<AdminVideo | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const dq = useDebounced(q);
  const params = useMemo(
    () => ({ q: dq, status, category, sort, page, limit: 24 }),
    [dq, status, category, sort, page]
  );
  const { data, loading, error, reload } = useFetch(() => api.videos(params), [params]);
  const catsFetch = useFetch(() => api.categories(), []);
  const categories = catsFetch.data?.categories ?? [];

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((v) => selected.has(v.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) items.forEach((v) => next.delete(v.id));
      else items.forEach((v) => next.add(v.id));
      return next;
    });
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doBulk = async (action: BulkAction) => {
    if (action === "delete") {
      setConfirmBulkDelete(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api.bulk([...selected], action);
      toast(`Done — ${r.done}/${r.total} videos updated`);
      setSelected(new Set());
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Bulk action failed", "info");
    } finally {
      setBusy(false);
    }
  };

  const executeDelete = async (video: AdminVideo) => {
    setBusy(true);
    try {
      await api.deleteVideo(video.id);
      toast("Video deleted");
      reload();
      setConfirmDelete(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete failed", "info");
    } finally {
      setBusy(false);
    }
  };

  const quickStatus = async (v: AdminVideo) => {
    setBusy(true);
    try {
      if (v.status === "published") {
        await api.unpublish(v.id);
        toast("Unpublished — hidden from public site");
      } else {
        await api.publish(v.id);
        toast("Published — now live on the public site");
      }
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed", "info");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Videos"
        sub={data ? `${data.total} total` : "Manage your catalog"}
        actions={<BtnLink to="/admin/upload" variant="primary" icon={UploadCloud}>Upload video</BtnLink>}
      />

      {/* Filters */}
      <div className="mb-4 grid min-w-0 grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_170px_180px_165px]">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search title or description…" className="col-span-2 md:col-span-1" />
        <Field label="">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="drafts">Drafts (draft + ready)</option>
            <option value="processing">Processing</option>
            <option value="uploading">Uploading</option>
            <option value="unpublished">Unpublished</option>
          </Select>
        </Field>
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>{c.name}</option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="views">Most views</option>
          <option value="title">Title A–Z</option>
          <option value="published">Recently published</option>
        </Select>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="glass sticky top-14 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-500/25 px-4 py-2.5 animate-fade-up lg:top-4">
          <span className="text-sm font-semibold text-white">{selected.size} selected</span>
          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
          <Btn size="sm" variant="subtle" busy={busy} icon={Globe} onClick={() => doBulk("publish")}>Publish</Btn>
          <Btn size="sm" variant="subtle" busy={busy} icon={EyeOff} onClick={() => doBulk("unpublish")}>Unpublish</Btn>
          <Btn size="sm" variant="danger" busy={busy} icon={Trash2} onClick={() => doBulk("delete")}>Delete</Btn>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs font-medium text-fog-500 hover:text-white">
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <Spinner label="Loading videos…" />
      ) : error ? (
        <EmptyBlock title="Couldn't load videos" body={error} action={<Btn variant="subtle" onClick={reload}>Retry</Btn>} />
      ) : items.length === 0 ? (
        <EmptyBlock
          icon={Film}
          title={dq || status || category ? "No videos match these filters" : "No videos yet"}
          body={dq || status || category ? "Try widening your search or clearing filters." : "Upload your first video to get started."}
          action={!dq && !status && !category ? <BtnLink to="/admin/upload" variant="primary" icon={UploadCloud}>Upload video</BtnLink> : undefined}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden min-w-0 overflow-x-auto rounded-2xl border border-white/6 md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/6 bg-ink-900/80 text-[11px] uppercase tracking-wider text-fog-600">
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="size-4 rounded accent-brand-500" />
                  </th>
                  <th className="px-3 py-3 font-semibold">Video</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Views</th>
                  <th className="px-3 py-3 font-semibold">Updated</th>
                  <th className="px-3 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((v) => (
                  <tr key={v.id} className="bg-ink-900/40 transition hover:bg-white/3">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleOne(v.id)} aria-label={`Select ${v.title}`} className="size-4 rounded accent-brand-500" />
                    </td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => navigate(`/admin/videos/${v.id}`)} className="group flex min-w-0 items-center gap-3 text-left">
                        <Thumb video={v} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fog-100 group-hover:text-brand-300">{v.title}</span>
                          <span className="mt-0.5 block text-xs text-fog-600">
                            {v.category_name ?? "Uncategorized"} · {fmtDur(v.duration_s)} · {fmtBytes(v.source_size)}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-3"><StatusBadge status={v.status} /></td>
                    <td className="px-3 py-3 tabular-nums text-fog-300">{fmtViews(v.views)}</td>
                    <td className="px-3 py-3 text-xs text-fog-500">{fmtDateTime(v.updated_at)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <Btn size="sm" variant="ghost" onClick={() => quickStatus(v)} busy={busy} aria-label={v.status === "published" ? "Unpublish" : "Publish"}>
                          {v.status === "published" ? <EyeOff className="size-4" aria-hidden /> : <Globe className="size-4" aria-hidden />}
                        </Btn>
                        <BtnLink to={`/admin/videos/${v.id}/analytics`} size="sm" variant="ghost" aria-label={`Analytics for ${v.title}`}>
                          <BarChart3 className="size-4" aria-hidden />
                        </BtnLink>
                        <BtnLink to={`/admin/videos/${v.id}`} size="sm" variant="ghost" aria-label={`Edit ${v.title}`}>
                          <SquarePen className="size-4" aria-hidden />
                        </BtnLink>
                        <Btn size="sm" variant="ghost" onClick={() => setConfirmDelete(v)} aria-label={`Delete ${v.title}`} className="hover:!text-red-400">
                          <Trash2 className="size-4" aria-hidden />
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {items.map((v) => (
              <div key={v.id} className="rounded-2xl border border-white/6 bg-ink-900/50 p-3">
                <div className="flex gap-3">
                  <Thumb video={v} className="w-32" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium text-fog-100">{v.title}</p>
                    <p className="mt-1 text-xs text-fog-600">{fmtViews(v.views)} views · {fmtDur(v.duration_s)}</p>
                    <div className="mt-2"><StatusBadge status={v.status} /></div>
                  </div>
                  <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleOne(v.id)} aria-label={`Select ${v.title}`} className="size-4 shrink-0 rounded accent-brand-500" />
                </div>
                <div className="mt-3 flex gap-2">
                  <Btn size="sm" variant="subtle" className="flex-1" onClick={() => quickStatus(v)} busy={busy}>
                    {v.status === "published" ? "Unpublish" : "Publish"}
                  </Btn>
                  <Btn size="sm" variant="subtle" className="flex-1" onClick={() => navigate(`/admin/videos/${v.id}`)}>Edit</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmDelete(v)} aria-label={`Delete ${v.title}`}>
                    <Trash2 className="size-4 text-red-400" aria-hidden />
                  </Btn>
                </div>
              </div>
            ))}
          </div>

          <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
        </>
      )}

      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && executeDelete(confirmDelete)}
        title="Delete video?"
        body={`“${confirmDelete?.title}” and its stored media will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete permanently"
        busy={busy}
      />
      <Confirm
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            const r = await api.bulk([...selected], "delete");
            toast(`Deleted ${r.done}/${r.total} videos`);
            setSelected(new Set());
            setConfirmBulkDelete(false);
            reload();
          } catch (e) {
            toast(e instanceof Error ? e.message : "Bulk delete failed", "info");
          } finally {
            setBusy(false);
          }
        }}
        title={`Delete ${selected.size} videos?`}
        body="All selected videos and their stored media will be permanently removed. This cannot be undone."
        confirmLabel="Delete permanently"
        busy={busy}
      />
    </div>
  );
}
