"use client";
import { FIXED_CATEGORIES } from "@/lib/public/fixed-categories";
import { resolveCategoryIcon } from "@/src/components/categoryIcons";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { ImagePlus, LoaderCircle, Pencil, X } from "lucide-react";
import { postJson } from "@/src/utils/api";
import { uploadWithProgress } from "@/src/utils/uploadFile";

export type Category = {
  id: string;
  label: string;
  slug: string;
  icon: string | null;
  description: string | null;
  image_url: string | null;
  video_count: number;
};

type CategoryForm = {
  label: string;
  slug: string;
  icon: string;
  description: string;
  /** Public URL of the card thumbnail — what gets saved. */
  imageUrl: string;
};

const emptyForm: CategoryForm = { label: "", slug: "", icon: "", description: "", imageUrl: "" };

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024;

function toForm(category: Category): CategoryForm {
  return {
    label: category.label,
    slug: category.slug,
    icon: category.icon || "",
    description: category.description || "",
    imageUrl: category.image_url || "",
  };
}

export default function CategoryManager({ initialCategories }: { initialCategories: Category[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const sortedCategories = useMemo(() => [...categories].sort((a, b) => FIXED_CATEGORIES.findIndex(c => c.slug === a.slug) - FIXED_CATEGORIES.findIndex(c => c.slug === b.slug)), [categories]);
  const formOpen = Boolean(editing);

  function openEdit(category: Category) {
    setEditing(category);
    setForm(toForm(category));
    setError("");
    setNotice("");
  }

  function closeForm() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
  }

  /**
   * Uploads the chosen image straight to Supabase Storage (signed URL) and
   * keeps the returned public URL in the form. The file bypasses the server
   * function body, so Vercel's 4.5 MB request limit never applies.
   */
  async function handleImageInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;

    if (!THUMBNAIL_TYPES.includes(file.type)) {
      setError("Category thumbnails must be JPG, PNG, GIF, or WebP.");
      return;
    }
    if (file.size > MAX_THUMBNAIL_SIZE) {
      setError("Category thumbnails must be 10 MB or smaller.");
      return;
    }

    setError("");
    setNotice("");
    setUploadingImage(true);
    try {
      const target = await postJson<{ uploadUrl: string; storagePath: string; publicUrl?: string }>(
        "/api/admin/uploads/thumbnail",
        {
          kind: "thumbnail",
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        }
      );
      await uploadWithProgress(target.uploadUrl, file, { contentType: file.type });
      // Prefer the URL storage reports; fall back to the storage path, which the
      // API resolves to a public URL on save.
      setForm((current) => ({ ...current, imageUrl: target.publicUrl || target.storagePath }));
      setNotice("Thumbnail uploaded — save the category to apply it.");
    } catch (uploadError: any) {
      setError(uploadError?.message || "Thumbnail upload failed");
    } finally {
      setUploadingImage(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editing ? { id: editing.id } : {}),
          description: form.description || null,
          // Empty string means "no thumbnail" — the API stores NULL and removes
          // the previous object.
          image_url: form.imageUrl || null,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Unable to save category");

      const category = json.category as Category;
      setCategories((current) => {
        const index = current.findIndex((item) => item.id === category.id);
        if (index === -1) return [...current, category];
        return current.map((item) => (item.id === category.id ? category : item));
      });
      setNotice("Category updated.");
      closeForm();
    } catch (saveError: any) {
      setError(saveError.message || "Unable to save category");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold">Categories</h1>
          <p className="mt-1 text-[12px] text-ink-3">The 12 categories are fixed. Update their descriptions and thumbnails here.</p>
        </div>

      </div>

      {notice && <p className="mt-4 rounded-md bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-300">{notice}</p>}

      {formOpen && (
        <form onSubmit={save} className="mt-6 rounded-lg border border-accent/30 bg-pcard p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold">{`Edit ${editing?.label}`}</h2>
              <p className="mt-1 text-[11px] text-ink-3">The slug is used in public category URLs.</p>
            </div>
            <button type="button" onClick={closeForm} aria-label="Close category form" className="rounded-md p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink">
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <p className="text-sm text-ink-3">{editing?.label} — /{editing?.slug}. Name and icon are fixed.</p>
            <label className="block md:col-span-2">
              <span className="mb-1 block text-[11px] font-medium">Description (optional)</span>
              <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={500} rows={3} className="w-full rounded-md border border-line bg-void px-3 py-2 text-[13px]" placeholder="A short public-facing description." />
            </label>

            {/* ---- Card thumbnail ---- */}
            <div className="md:col-span-2">
              <span className="mb-1 block text-[11px] font-medium">Card thumbnail (optional)</span>
              <div className="flex flex-wrap items-start gap-3 rounded-md border border-dashed border-line bg-void p-3">
                <div className="w-[168px] shrink-0">
                  {form.imageUrl ? (
                    <div className="relative overflow-hidden rounded-md border border-line">
                      {/* Plain <img>: the URL is arbitrary (Supabase Storage) and already sized by the admin. */}
                      <img src={form.imageUrl} alt="" className="aspect-video w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setForm((current) => ({ ...current, imageUrl: "" }))}
                        aria-label="Remove category thumbnail"
                        className="absolute right-1 top-1 rounded bg-black/70 p-1 text-ink hover:text-red-300"
                      >
                        <X aria-hidden="true" className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-line bg-card text-ink-3">
                      <ImagePlus aria-hidden="true" className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-[200px] flex-1">
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-card px-3 text-[11.5px] font-medium hover:bg-card-hover">
                    {uploadingImage ? (
                      <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus aria-hidden="true" className="h-3.5 w-3.5" />
                    )}
                    {uploadingImage ? "Uploading…" : form.imageUrl ? "Replace image" : "Upload image"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={handleImageInput}
                      disabled={uploadingImage}
                      className="sr-only"
                    />
                  </label>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
                    JPG, PNG, GIF, or WebP up to 10 MB. Shown on the category card; when no image is set the card keeps
                    its icon. Removing the image deletes the stored file when you save.
                  </p>
                </div>
              </div>
            </div>
          </div>
          {error && <p className="mt-4 rounded-md bg-red-500/10 p-3 text-[12px] text-red-400">{error}</p>}
          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={saving || uploadingImage} className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-[12px] font-semibold text-white disabled:opacity-50">
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button type="button" onClick={closeForm} className="h-9 rounded-md border border-line px-4 text-[12px] text-ink-2 hover:text-ink">Cancel</button>
          </div>
        </form>
      )}

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortedCategories.map((category) => { const Icon = resolveCategoryIcon(category.icon, category.slug); return (
          <article key={category.id} className="overflow-hidden rounded-lg border border-line bg-pcard">
            {category.image_url ? (
              <img src={category.image_url} alt="" className="aspect-[16/7] w-full object-cover" />
            ) : null}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-[13px] font-medium"><Icon aria-hidden className="h-4 w-4 text-accent" />{category.label}</p>
                  <p className="mt-1 font-mono text-[10.5px] text-ink-3">/{category.slug}</p>
                </div>
                <button type="button" onClick={() => openEdit(category)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] text-ink-2 hover:bg-white/5 hover:text-ink">
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                  Edit
                </button>
              </div>
              {category.description && <p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-ink-3">{category.description}</p>}
              <div className="mt-3 flex gap-3 text-[10.5px] text-ink-3">
                <span>Icon: {category.icon || "—"}</span>
                <span>Thumbnail: {category.image_url ? "set" : "—"}</span>
                <span>{category.video_count || 0} videos</span>
              </div>
            </div>
          </article>
        ); })}
      </div>

      {!sortedCategories.length && (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-8 text-center">
          <p className="text-[13px]">Apply the fixed-category database migration to load the categories.</p>
        </div>
      )}
    </div>
  );
}
