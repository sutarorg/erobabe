import { useState } from "react";
import { FolderOpen, Hash, ImagePlus, PencilLine, Plus, Trash2 } from "lucide-react";
import { api, type AdminCategory } from "./api";
import {
  Btn, Confirm, EmptyBlock, Field, FieldGroup, Input, Modal, PageHeader, Select, Spinner, Tabs, useFetch,
} from "./ui";
import { CATEGORY_ICONS, ICON_BY_SLUG, ICON_OPTIONS, resolveCategoryIcon } from "@/lib/categoryIcons";
import { toast } from "@/components/Feedback";
import { cn } from "@/lib/format";

const GRADIENTS = [
  "from-zinc-500/70 via-zinc-800/40",
  "from-rose-600/80 via-rose-900/40",
  "from-fuchsia-600/80 via-fuchsia-900/40",
  "from-purple-600/80 via-purple-900/40",
  "from-violet-600/80 via-violet-900/40",
  "from-pink-600/80 via-pink-900/40",
  "from-red-600/80 via-red-900/40",
  "from-amber-600/80 via-amber-900/40",
  "from-indigo-600/80 via-indigo-900/40",
];

const slugify = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * Icon picker — nine options, each visually representing the kind of
 * category it is meant for. Keys come from the shared registry, so the
 * public site renders exactly the same glyph the admin selects.
 */
function IconPicker({
  value, slug, onChange,
}: { value: string; slug?: string; onChange: (key: string) => void }) {
  const effective = value || (slug ? ICON_BY_SLUG[slug] ?? "" : "");
  const selected = ICON_OPTIONS.find((o) => o.key === effective);
  return (
    <div className="rounded-xl border border-white/8 bg-ink-850 p-2.5">
      <div
        role="radiogroup"
        aria-label="Category icon"
        className="grid grid-cols-7 gap-1.5 sm:grid-cols-10"
      >
        {ICON_OPTIONS.map((opt) => {
          const Icon = CATEGORY_ICONS[opt.key] ?? resolveCategoryIcon(null, opt.key);
          const active = effective === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.key)}
              title={`${opt.label} — ${opt.represents}`}
              aria-label={`${opt.label}, represents ${opt.represents}`}
              className={cn(
                "grid aspect-square place-items-center rounded-lg border transition active:scale-90",
                active
                  ? "border-brand-500/60 bg-brand-500/15 text-brand-200 ring-1 ring-brand-500/40"
                  : "border-transparent bg-white/4 text-fog-400 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 border-t border-white/6 pt-2 text-[11px] text-fog-500">
        {selected ? (
          <>
            Selected: <span className="font-medium text-fog-300">{selected.label}</span>
            <span className="text-fog-600"> · {selected.represents}</span>
          </>
        ) : (
          "Choose an icon — shown on Explore, category pages and the sidebar."
        )}
      </p>
    </div>
  );
}

function CategoriesTab() {
  const { data, loading, reload } = useFetch(() => api.categories(), []);
  const categories = data?.categories ?? [];
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [icon, setIcon] = useState(ICON_OPTIONS[0].key);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.createCategory({ name: name.trim(), blurb: blurb.trim() || undefined, icon });
      toast("Category created");
      setName("");
      setBlurb("");
      setIcon(ICON_OPTIONS[0].key);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Create failed", "info");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="space-y-4 rounded-2xl border border-white/6 bg-ink-900/60 p-4"
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" maxLength={60} aria-label="Category name" />
          <Input value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="Short blurb (optional)" maxLength={160} aria-label="Category blurb" />
          <Btn variant="primary" icon={Plus} busy={creating} type="submit">Add category</Btn>
        </div>
        <FieldGroup label="Icon">
          <IconPicker value={icon} onChange={setIcon} />
        </FieldGroup>
      </form>

      {loading ? (
        <Spinner label="Loading categories…" />
      ) : categories.length === 0 ? (
        <EmptyBlock icon={FolderOpen} title="No categories yet" body="Create your first category above." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {categories.map((c) => (
            <div key={c.id} className="group relative overflow-hidden rounded-2xl border border-white/6 bg-ink-900/60 p-4 transition hover:border-white/12">
              <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", c.gradient)} aria-hidden />
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/8 bg-ink-850 text-brand-300">
                  {(() => {
                    const Icon = resolveCategoryIcon(c.slug, c.icon);
                    return <Icon className="size-4.5" aria-hidden />;
                  })()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{c.name}</p>
                  <p className="mt-0.5 text-xs text-fog-600">/{c.slug} · {c.count} videos</p>
                  {c.blurb && <p className="mt-1.5 line-clamp-2 text-xs text-fog-500">{c.blurb}</p>}
                </div>
                <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-fog-500">#{c.sort}</span>
              </div>
              <div className="mt-3 flex justify-end gap-1.5 border-t border-white/5 pt-3">
                <Btn size="sm" variant="ghost" icon={PencilLine} onClick={() => setEditing(c)}>Edit</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setDeleting(c)} className="hover:!text-red-400" aria-label={`Delete ${c.name}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      <CategoryModal
        category={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api.deleteCategory(deleting.id);
            toast("Category deleted");
            setDeleting(null);
            reload();
          } catch (e) {
            toast(e instanceof Error ? e.message : "Delete failed", "info");
          } finally {
            setBusy(false);
          }
        }}
        title={`Delete “${deleting?.name}”?`}
        body="Categories that still contain videos cannot be deleted. This action cannot be undone."
        confirmLabel="Delete"
        busy={busy}
      />
    </div>
  );
}

function CategoryModal({
  category, onClose, onSaved,
}: { category: AdminCategory | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string | number>>({});
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState<string | null>(null);

  if (category && synced !== category.id) {
    setSynced(category.id);
    setForm({
      name: category.name,
      slug: category.slug,
      blurb: category.blurb ?? "",
      gradient: category.gradient,
      imageUrl: category.image_url ?? "",
      icon: category.icon ?? "",
      sort: category.sort,
    });
  }

  const save = async () => {
    if (!category) return;
    setBusy(true);
    try {
      await api.patchCategory(category.id, {
        name: String(form.name),
        slug: String(form.slug),
        blurb: String(form.blurb),
        gradient: String(form.gradient),
        imageUrl: String(form.imageUrl),
        icon: String(form.icon ?? ""),
        sort: Number(form.sort) || 0,
      });
      toast("Category updated");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "info");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!category} onClose={onClose} title="Edit category" wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={String(form.name ?? "")} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: slugify(e.target.value) || f.slug }))} />
          </Field>
          <Field label="Blurb">
            <Input value={String(form.blurb ?? "")} onChange={(e) => setForm((f) => ({ ...f, blurb: e.target.value }))} maxLength={160} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_130px]">
          <Field label="Slug" hint="Used in /category/slug URLs">
            <Input value={String(form.slug ?? "")} onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))} />
          </Field>
          <Field label="Sort order">
            <Input type="number" value={Number(form.sort ?? 0)} onChange={(e) => setForm((f) => ({ ...f, sort: Number(e.target.value) || 0 }))} />
          </Field>
        </div>
        <FieldGroup label="Icon">
          <IconPicker
            value={String(form.icon ?? "")}
            slug={category?.slug}
            onChange={(key) => setForm((f) => ({ ...f, icon: key }))}
          />
        </FieldGroup>
        <Field label="Card gradient">
          <Select value={String(form.gradient ?? "")} onChange={(e) => setForm((f) => ({ ...f, gradient: e.target.value }))}>
            {GRADIENTS.map((g) => (
              <option key={g} value={g}>{g.replace(/from-|via-/g, "").replace(/\//g, "").replace("/40", "").trim()}</option>
            ))}
          </Select>
        </Field>
        <Field label="Cover image" hint="Paste a URL or upload a new image below.">
          <div className="flex gap-2">
            <Input value={String(form.imageUrl ?? "")} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" />
            <label className="grid h-10.5 w-13 shrink-0 cursor-pointer place-items-center rounded-lg border border-white/10 bg-ink-850 text-fog-400 hover:border-white/25 hover:text-white" aria-label="Upload cover image">
              <ImagePlus className="size-4" aria-hidden />
              <input
                type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = async () => {
                    try {
                      const r = await api.uploadMedia({ dataUrl: String(reader.result), kind: "media" });
                      setForm((prev) => ({ ...prev, imageUrl: r.url }));
                      toast("Image uploaded");
                    } catch (err) {
                      toast(err instanceof Error ? err.message : "Upload failed", "info");
                    }
                  };
                  reader.readAsDataURL(f);
                }}
              />
            </label>
          </div>
        </Field>
        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-white/8 bg-ink-900/95 px-5 py-4 backdrop-blur md:-mx-6 md:-mb-5 md:px-6">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" busy={busy} onClick={save}>Save changes</Btn>
        </div>
      </div>
    </Modal>
  );
}

function TagsTab() {
  const { data, loading, reload } = useFetch(() => api.tags(), []);
  const tags = data?.tags ?? [];
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      {loading ? (
        <Spinner label="Loading tags…" />
      ) : tags.length === 0 ? (
        <EmptyBlock icon={Hash} title="No tags yet" body="Tags appear automatically as you add them to videos." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/6">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/6 bg-ink-900/80 text-[11px] uppercase tracking-wider text-fog-600">
                <th className="px-4 py-3 font-semibold">Tag</th>
                <th className="px-4 py-3 font-semibold">Videos</th>
                <th className="px-4 py-3 text-right font-semibold">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tags.map((t) => (
                <tr key={t.name} className="bg-ink-900/40">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/6 px-2 py-1 text-xs font-medium text-fog-200">
                      <Hash className="size-3 text-fog-500" aria-hidden />
                      {t.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fog-400">{t.count}</td>
                  <td className="px-4 py-3 text-right">
                    <Btn size="sm" variant="ghost" onClick={() => setDeleting(t.name)} aria-label={`Remove tag ${t.name}`}>
                      <Trash2 className="size-4 text-red-400" aria-hidden />
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            const r = await api.removeTag(deleting);
            toast(`Removed from ${r.removed} videos`);
            setDeleting(null);
            reload();
          } catch (e) {
            toast(e instanceof Error ? e.message : "Remove failed", "info");
          } finally {
            setBusy(false);
          }
        }}
        title={`Remove tag “${deleting}”?`}
        body="The tag will be stripped from every video that uses it. Videos themselves are not affected."
        confirmLabel="Remove everywhere"
        busy={busy}
      />
    </div>
  );
}

export default function Taxonomy() {
  const [tab, setTab] = useState("categories");
  return (
    <div>
      <PageHeader title="Categories & Tags" sub="Organize the catalog and search surface." />
      <Tabs tabs={[{ key: "categories", label: "Categories" }, { key: "tags", label: "Tags" }]} active={tab} onChange={setTab} />
      {tab === "categories" ? <CategoriesTab /> : <TagsTab />}
    </div>
  );
}
