/**
 * Remaining admin pages: Categories, Tags, Analytics, Storage,
 * Settings and the Activity log.
 */
import { useMemo, useState } from "react";
import {
  Activity as ActivityIcon, BarChart3, ChevronDown, ChevronUp,
  GitMerge, HardDrive, Info, Pencil, Plus, Save, Search, Tags as TagsIcon,
  Trash2,
} from "lucide-react";
import { FALLBACK_THUMB, formatBytes, formatViews, slugify, THUMBS } from "../data/videos";
import { ADMIN_ICON_CHOICES, getCategoryIcon } from "../lib/icons";
import { relative, ViewsChart } from "./dashboard";
import { useAdmin, type AdminCategory } from "./store";
import { areaCls, Card, Field, inputCls, PageHeader } from "./AdminApp";
import { Button, Modal, Toggle } from "../components/ui";
import { cn } from "../utils/cn";
import type { SiteSettings } from "../lib/api";

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export function AdminCategoriesPage() {
  const { state, upsertCategory, deleteCategory, moveCategory } = useAdmin();
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<AdminCategory | null>(null);
  const sorted = [...state.categories].sort((a, b) => a.order - b.order);

  return (
    <div className="anim-fade-up">
      <PageHeader
        title="Categories"
        sub={`${sorted.length} categories — reorder, rename or restyle`}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={13} /> New category
          </Button>
        }
      />
      <Card className="divide-y divide-eb-line overflow-hidden">
        {sorted.map((c, i) => {
          const count = state.videos.filter((v) => v.category === c.slug).length;
          const CatIcon = getCategoryIcon(c.icon);
          return (
            <div key={c.slug} className="flex items-center gap-4 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-eb-rose/25 to-eb-violet/25 text-eb-rose-soft" title={`Icon: ${c.icon}`}>
                <CatIcon size={17} />
              </span>
              <img src={c.image || FALLBACK_THUMB} alt="" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="hidden h-11 w-16 rounded-lg object-cover sm:block" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">
                  {c.name} {c.virtual && <span className="ml-1 rounded-full border border-eb-line px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-eb-faint uppercase">feed</span>}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-eb-faint">/{c.slug} • {count} video(s)</p>
              </div>
              <div className="flex items-center gap-1">
                <IconAction label="Move up" disabled={i === 0} onClick={() => moveCategory(c.slug, -1)}><ChevronUp size={14} /></IconAction>
                <IconAction label="Move down" disabled={i === sorted.length - 1} onClick={() => moveCategory(c.slug, 1)}><ChevronDown size={14} /></IconAction>
                <IconAction label="Edit" onClick={() => setEditing(c)}><Pencil size={14} /></IconAction>
                <IconAction label="Delete" danger onClick={() => setDel(c)}><Trash2 size={14} /></IconAction>
              </div>
            </div>
          );
        })}
      </Card>

      <CategoryForm open={creating || Boolean(editing)} initial={editing} onClose={() => { setCreating(false); setEditing(null); }} onSave={(c) => { upsertCategory(c); setCreating(false); setEditing(null); }} nextOrder={sorted.length} />

      <Modal open={Boolean(del)} onClose={() => setDel(null)} title={`Delete category "${del?.name}"?`}>
        <p className="text-sm text-eb-muted">
          Videos in this category keep their category slug until reassigned. The public category page will return a "not found" state.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDel(null)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={() => { if (del) deleteCategory(del.slug); setDel(null); }}>
            <Trash2 size={13} /> Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function CategoryForm({ open, initial, onClose, onSave, nextOrder }: { open: boolean; initial: AdminCategory | null; onClose: () => void; onSave: (c: AdminCategory) => void; nextOrder: number }) {
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [slug, setSlug] = useState("");
  const [icon, setIcon] = useState("tag");

  // sync when opening
  const [synced, setSynced] = useState(false);
  if (open && !synced) {
    setName(initial?.name ?? "");
    setBlurb(initial?.blurb ?? "");
    setSlug(initial?.slug ?? "");
    setIcon(initial?.icon ?? ADMIN_ICON_CHOICES[0].key);
    setSynced(true);
  }
  if (!open && synced) setSynced(false);

  // The 9 curated options, plus the category's current icon when it comes
  // from the extended seeded set — so editing never silently drops it.
  const extraIcon = icon && !ADMIN_ICON_CHOICES.some((o) => o.key === icon)
    ? [{ key: icon, label: "Current", hint: "Seeded icon" }]
    : [];
  const options = [...ADMIN_ICON_CHOICES, ...extraIcon];
  const PreviewIcon = getCategoryIcon(icon);

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit category" : "New category"}>
      <div className="space-y-4">
        <Field label="Name *">
          <input className={inputCls} value={name} onChange={(e) => { setName(e.target.value); if (!initial) setSlug(slugify(e.target.value)); }} />
        </Field>
        <Field label="Slug">
          <input className={inputCls} value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
        </Field>
        <Field label="Description / blurb">
          <textarea className={areaCls} rows={2} value={blurb} onChange={(e) => setBlurb(e.target.value)} />
        </Field>

        <Field label="Icon" hint="Shown on Explore, category pages, cards and navigation. 9 options available.">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Category icon">
            {options.map((o) => {
              const Icon = getCategoryIcon(o.key);
              const active = icon === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={o.hint}
                  onClick={() => setIcon(o.key)}
                  className={cn(
                    "ring-focus flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition",
                    active
                      ? "border-transparent bg-gradient-to-br from-eb-rose/30 to-eb-violet/30 text-white shadow-md shadow-eb-rose/15 ring-1 ring-eb-rose/60"
                      : "border-eb-line bg-eb-850 text-eb-faint hover:border-white/20 hover:text-white"
                  )}
                >
                  <Icon size={18} />
                  <span className="text-[9px] font-bold tracking-wide">{o.label}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <div className="flex items-center gap-3 rounded-xl border border-eb-line bg-eb-850 px-3.5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-eb-rose/25 to-eb-violet/25 text-eb-rose-soft">
            <PreviewIcon size={16} />
          </span>
          <p className="text-xs text-eb-muted">
            Preview: <span className="font-semibold text-white">{name || "Category name"}</span> — this icon appears everywhere the category is listed.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!name.trim() || !slug.trim()}
            onClick={() =>
              onSave({
                ...(initial ?? { accent: "from-rose-600/60", order: nextOrder, image: THUMBS[(nextOrder * 7) % THUMBS.length] }),
                name: name.trim(),
                slug: slug.trim(),
                blurb: blurb.trim(),
                icon,
              })
            }
          >
            <Save size={13} /> Save category
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

export function AdminTagsPage() {
  const { state, upsertTag, renameTag, mergeTags, deleteTag } = useAdmin();
  const [q, setQ] = useState("");
  const [newTag, setNewTag] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState("");

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    state.videos.forEach((v) => v.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return m;
  }, [state.videos]);

  const tags = state.tags
    .filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (usage.get(b.name) ?? 0) - (usage.get(a.name) ?? 0));

  const toggleSel = (name: string) => {
    const next = new Set(selected);
    next.has(name) ? next.delete(name) : next.add(name);
    setSelected(next);
  };

  return (
    <div className="anim-fade-up space-y-5">
      <PageHeader title="Tags" sub={`${state.tags.length} tags — relational in production (tags + video_tags)`} />
      <div className="flex flex-wrap gap-2.5">
        <div className="flex h-10 min-w-52 flex-1 items-center gap-2 rounded-xl border border-eb-line bg-eb-850 px-3.5">
          <Search size={14} className="text-eb-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags…" className="h-full w-full bg-transparent text-sm text-white outline-none placeholder:text-eb-faint" />
        </div>
        <div className="flex h-10 items-center gap-2 rounded-xl border border-eb-line bg-eb-850 px-3.5">
          <Plus size={14} className="text-eb-faint" />
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTag.trim()) {
                upsertTag(newTag.trim());
                setNewTag("");
              }
            }}
            placeholder="Create tag + Enter"
            className="h-full w-40 bg-transparent text-sm text-white outline-none placeholder:text-eb-faint"
          />
        </div>
      </div>

      {selected.size > 1 && (
        <div className="anim-fade flex flex-wrap items-center gap-2.5 rounded-xl border border-eb-line bg-eb-850 px-4 py-3">
          <GitMerge size={14} className="text-eb-violet" />
          <span className="text-xs font-semibold text-white">Merge {selected.size} tags into:</span>
          <input value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} placeholder="target tag name" className="h-8 w-40 rounded-lg border border-eb-line bg-eb-900 px-3 text-xs text-white outline-none" />
          <Button
            size="sm"
            disabled={!mergeTarget.trim()}
            onClick={() => {
              mergeTags([...selected], mergeTarget.trim());
              upsertTag(mergeTarget.trim());
              setSelected(new Set());
              setMergeTarget("");
            }}
          >
            Merge
          </Button>
          <button onClick={() => setSelected(new Set())} className="cursor-pointer text-xs font-semibold text-eb-faint hover:text-white">Clear</button>
        </div>
      )}

      <Card className="divide-y divide-eb-line overflow-hidden">
        {tags.map((t) => (
          <div key={t.name} className="flex items-center gap-3 px-4 py-3">
            <input type="checkbox" checked={selected.has(t.name)} onChange={() => toggleSel(t.name)} aria-label={`Select tag ${t.name}`} className="cursor-pointer" />
            <TagsIcon size={14} className="shrink-0 text-eb-rose-soft" />
            {renaming === t.name ? (
              <input
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameVal.trim()) {
                    renameTag(t.name, renameVal.trim());
                    setRenaming(null);
                  }
                  if (e.key === "Escape") setRenaming(null);
                }}
                onBlur={() => setRenaming(null)}
                className="h-8 w-44 rounded-lg border border-eb-rose/40 bg-eb-900 px-2.5 text-xs text-white outline-none"
              />
            ) : (
              <span className="text-sm font-medium text-white">{t.name}</span>
            )}
            <span className="text-[11px] text-eb-faint">{usage.get(t.name) ?? 0} video(s)</span>
            <div className="ml-auto flex items-center gap-1">
              <IconAction label="Rename" onClick={() => { setRenaming(t.name); setRenameVal(t.name); }}><Pencil size={13} /></IconAction>
              <IconAction label="Delete" danger onClick={() => deleteTag(t.name)}><Trash2 size={13} /></IconAction>
            </div>
          </div>
        ))}
        {tags.length === 0 && <p className="p-8 text-center text-sm text-eb-muted">No tags match.</p>}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

const RANGES = [
  { key: "1", label: "24h", days: 1 },
  { key: "7", label: "7d", days: 7 },
  { key: "30", label: "30d", days: 30 },
  { key: "all", label: "All time", days: 90 },
] as const;

export function AdminAnalyticsPage() {
  const { state, events } = useAdmin();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("7");
  const days = RANGES.find((r) => r.key === range)!.days;
  const now = Date.now();
  const inRange = events.filter((e) => now - e.ts < days * 864e5);

  const top = useMemo(() => {
    const m = new Map<string, number>();
    inRange.forEach((e) => m.set(e.videoId, (m.get(e.videoId) ?? 0) + 1));
    return [...m.entries()]
      .map(([id, n]) => ({ video: state.videos.find((v) => v.id === id), n }))
      .filter((x) => x.video)
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
  }, [inRange, state.videos]);

  const catPerf = useMemo(() => {
    const m = new Map<string, number>();
    inRange.forEach((e) => {
      const cat = state.videos.find((v) => v.id === e.videoId)?.category;
      if (cat) m.set(cat, (m.get(cat) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [inRange, state.videos]);

  const avgWatch = inRange.length ? Math.round(inRange.reduce((a, e) => a + e.seconds, 0) / inRange.length) : 0;
  const sessions = new Set(inRange.map((e) => e.session)).size;

  return (
    <div className="anim-fade-up space-y-6">
      <PageHeader
        title="Analytics"
        sub="Real view events recorded by the 10-second watch threshold."
        actions={
          <div className="flex rounded-full border border-eb-line bg-eb-850 p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  "cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold transition",
                  range === r.key ? "bg-gradient-to-r from-eb-rose to-eb-violet text-white" : "text-eb-faint hover:text-white"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={`Views (${RANGES.find((r) => r.key === range)!.label})`} value={String(inRange.length)} icon={<BarChart3 size={14} />} />
        <StatCard label="Unique sessions" value={String(sessions)} icon={<ActivityIcon size={14} />} />
        <StatCard label="Avg watch time" value={`${Math.floor(avgWatch / 60)}m ${avgWatch % 60}s`} icon={<ActivityIcon size={14} />} />
        <StatCard label="Published videos" value={String(state.videos.filter((v) => v.status === "PUBLISHED").length)} icon={<BarChart3 size={14} />} />
      </div>

      <Card className="p-5">
        <h2 className="font-display mb-4 text-sm font-bold text-white">Views over time</h2>
        <ViewsChart events={events} days={Math.min(days, 30)} height={200} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display mb-4 text-sm font-bold text-white">Top videos</h2>
          <ol className="space-y-2.5">
            {top.map(({ video, n }, i) => (
              <li key={video!.id} className="flex items-center gap-3">
                <span className={cn("font-display w-8 shrink-0 text-center text-xl font-bold", i < 3 ? "outline-num-accent" : "outline-num")}>{String(i + 1).padStart(2, "0")}</span>
                <img src={video!.thumbnail || FALLBACK_THUMB} alt="" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="h-9 w-14 shrink-0 rounded-md object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-eb-text">{video!.title}</p>
                  <p className="text-[10px] text-eb-faint">{formatViews(video!.views)} lifetime • {n} in range</p>
                </div>
                <span className="font-display shrink-0 text-sm font-bold text-eb-rose-soft">{n}</span>
              </li>
            ))}
            {top.length === 0 && <p className="py-6 text-center text-xs text-eb-faint">No views recorded in this range yet — watch a few videos.</p>}
          </ol>
        </Card>

        <Card className="p-5">
          <h2 className="font-display mb-4 text-sm font-bold text-white">Category performance</h2>
          <div className="space-y-3">
            {catPerf.map(([slug, n]) => {
              const max = catPerf[0]?.[1] ?? 1;
              return (
                <div key={slug}>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="font-semibold text-eb-text capitalize">{slug}</span>
                    <span className="text-eb-faint">{n} views</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-eb-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-eb-rose to-eb-violet transition-all duration-500" style={{ width: `${Math.max(4, (n / max) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
            {catPerf.length === 0 && <p className="py-6 text-center text-xs text-eb-faint">No data yet.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold tracking-widest text-eb-faint uppercase">{label}</p>
        <span className="text-eb-rose-soft">{icon}</span>
      </div>
      <p className="font-display mt-2 text-2xl font-bold text-white">{value}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export function AdminStoragePage() {
  const { state } = useAdmin();
  const total = state.videos.reduce((a, v) => a + (v.fileSize ?? 0), 0);
  const originals = state.videos.filter((v) => v.fileName).length;
  const episodic = state.videos.filter((v) => v.sourceEphemeral);
  const seg = [
    { label: "Original uploads", bytes: total, cls: "from-eb-rose to-eb-violet" },
    { label: "Encoded renditions (est.)", bytes: Math.round(total * 0.62), cls: "from-violet-600 to-indigo-500" },
    { label: "Thumbnails & posters", bytes: state.videos.length * 184_000, cls: "from-fuchsia-600 to-pink-500" },
    { label: "Preview clips (est.)", bytes: Math.round(total * 0.04), cls: "from-rose-500 to-orange-400" },
  ];
  const grand = seg.reduce((a, s) => a + s.bytes, 0);

  return (
    <div className="anim-fade-up space-y-6">
      <PageHeader title="Storage" sub="Object usage across originals, renditions and images." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total (est.)" value={formatBytes(grand)} icon={<HardDrive size={14} />} />
        <StatCard label="Original files" value={String(originals)} icon={<HardDrive size={14} />} />
        <StatCard label="Thumbnails" value={String(state.videos.length)} icon={<HardDrive size={14} />} />
        <StatCard label="R2 usage (API)" value="Not linked" icon={<Info size={14} />} />
      </div>

      <Card className="p-5">
        <h2 className="font-display mb-4 text-sm font-bold text-white">Breakdown</h2>
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-eb-800">
          {seg.map((s) => (
            <div key={s.label} className={cn("h-full bg-gradient-to-r", s.cls)} style={{ width: `${(s.bytes / grand) * 100}%` }} title={s.label} />
          ))}
        </div>
        <ul className="mt-4 space-y-2">
          {seg.map((s) => (
            <li key={s.label} className="flex items-center gap-2.5 text-xs text-eb-muted">
              <span className={cn("h-2.5 w-2.5 rounded-sm bg-gradient-to-r", s.cls)} />
              {s.label}
              <span className="ml-auto font-semibold text-eb-text">{formatBytes(s.bytes)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-xl border border-eb-line bg-eb-850 px-4 py-3 text-[11px] leading-relaxed text-eb-faint">
          Connect Cloudflare R2 credentials to read exact bucket usage and run orphan-object cleanup directly from here.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="font-display mb-1 text-sm font-bold text-white">Orphaned objects</h2>
        <p className="mb-4 text-[11px] text-eb-faint">Files present in storage but not referenced by any database record.</p>
        {episodic.length === 0 ? (
          <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 text-xs text-emerald-300">No orphaned demo objects detected.</p>
        ) : (
          <ul className="space-y-2">
            {episodic.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/6 px-4 py-3 text-xs">
                <span className="min-w-0 flex-1 truncate text-eb-text">originals/{v.id}/{v.fileName ?? "source.mp4"}</span>
                <span className="text-eb-faint">{formatBytes(v.fileSize ?? 0)}</span>
                <span className="rounded-full border border-amber-500/25 px-2 py-0.5 text-[10px] font-bold text-amber-400">SESSION-ONLY DEMO COPY</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function AdminSettingsPage() {
  const { state, saveSettings } = useAdmin();
  const [form, setForm] = useState<SiteSettings>({ ...state.settings, sections: { ...state.settings.sections } });
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<SiteSettings>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };
  const setSection = (key: keyof SiteSettings["sections"], v: boolean) => {
    setForm((f) => ({ ...f, sections: { ...f.sections, [key]: v } }));
    setSaved(false);
  };

  const save = () => {
    saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="anim-fade-up mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        sub="Store-driven configuration consumed live by the public site."
        actions={
          <Button size="sm" onClick={save} variant={saved ? "glass" : "primary"}>
            <Save size={13} /> {saved ? "Saved" : "Save settings"}
          </Button>
        }
      />

      <div className="space-y-5">
        <Card className="space-y-4 p-5">
          <SectionTitle>General</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site name">
              <input className={inputCls} value={form.siteName} onChange={(e) => set({ siteName: e.target.value })} />
            </Field>
            <Field label="Tagline">
              <input className={inputCls} value={form.siteTagline} onChange={(e) => set({ siteTagline: e.target.value })} />
            </Field>
          </div>
          <p className="text-[11px] text-eb-faint">Site URL is configured via the PUBLIC_SITE_URL environment variable at deploy time.</p>
        </Card>

        <Card className="space-y-1 p-5">
          <SectionTitle>Homepage sections</SectionTitle>
          {(
            [
              ["featured", "Featured hero"],
              ["trending", "Trending now carousel"],
              ["popular", "Popular grid"],
              ["newest", "New releases"],
              ["categories", "Category cards"],
              ["mostWatched", "Most watched ranking"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center justify-between border-b border-eb-line py-3 last:border-0">
              <span className="text-sm text-eb-text">{label}</span>
              <Toggle on={form.sections[key]} onChange={(v) => setSection(key, v)} label={label} />
            </label>
          ))}
        </Card>

        <Card className="space-y-4 p-5">
          <SectionTitle>Age gate</SectionTitle>
          <label className="flex cursor-pointer items-center justify-between">
            <span className="text-sm text-eb-text">Require 18+ confirmation</span>
            <Toggle on={form.ageGateEnabled} onChange={(v) => set({ ageGateEnabled: v })} label="Age gate" />
          </label>
          <Field label="Gate message">
            <textarea className={areaCls} rows={2} value={form.ageGateMessage} onChange={(e) => set({ ageGateMessage: e.target.value })} />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <SectionTitle>Analytics & views</SectionTitle>
          <label className="flex cursor-pointer items-center justify-between">
            <span className="text-sm text-eb-text">Enable view counting</span>
            <Toggle on={form.viewsEnabled} onChange={(v) => set({ viewsEnabled: v })} label="View counting" />
          </label>
          <Field label="View threshold (seconds watched before a view counts)" hint="Production API also validates this server-side">
            <input type="number" min={3} max={120} className={inputCls} value={form.viewThresholdSec} onChange={(e) => set({ viewThresholdSec: Math.max(3, Number(e.target.value)) })} />
          </Field>
        </Card>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display mb-1 text-sm font-bold text-white">{children}</h2>;
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export function AdminActivityPage() {
  const { state } = useAdmin();
  return (
    <div className="anim-fade-up">
      <PageHeader title="Activity Log" sub="Every administrative action, most recent first." />
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-eb-line text-[10px] tracking-widest text-eb-faint uppercase">
              <th className="px-5 py-3">Action</th>
              <th className="px-3 py-3">Entity</th>
              <th className="hidden px-3 py-3 sm:table-cell">Detail</th>
              <th className="px-3 py-3 text-right">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-eb-line">
            {state.activity.map((a) => (
              <tr key={a.id} className="transition hover:bg-white/[0.02]">
                <td className="px-5 py-3 text-xs font-semibold text-eb-text">{a.action}</td>
                <td className="px-3 py-3 text-xs text-eb-muted capitalize">{a.entity}</td>
                <td className="hidden max-w-56 truncate px-3 py-3 text-xs text-eb-faint sm:table-cell">{a.detail ?? "—"}</td>
                <td className="px-3 py-3 text-right text-xs whitespace-nowrap text-eb-faint">{relative(a.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function IconAction({ children, label, onClick, danger, disabled }: { children: React.ReactNode; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "ring-focus flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition disabled:opacity-30",
        danger ? "text-eb-faint hover:bg-red-500/10 hover:text-red-400" : "text-eb-faint hover:bg-white/5 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

