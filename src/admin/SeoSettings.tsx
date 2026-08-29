import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, Code2, ExternalLink, Globe, RotateCcw, Save, Search,
} from "lucide-react";
import { api } from "./api";
import {
  Btn, Confirm, EmptyBlock, Field, Input, PageHeader, Select, Spinner, Textarea, Toggle, useDebounced, useFetch,
} from "./ui";
import { toast } from "@/components/Feedback";
import { cn } from "@/lib/format";

/** Everything an admin can override for one page. */
interface SeoPage {
  path_key: string;
  label?: string | null;
  path?: string;
  overridden?: boolean;
  seo_title?: string | null;
  meta_description?: string | null;
  keywords?: string | null;
  canonical_url?: string | null;
  robots?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  json_ld?: string | null;
  in_sitemap?: boolean;
}

const ROBOTS_OPTIONS = [
  { value: "index,follow", label: "Index, Follow (default)" },
  { value: "noindex,follow", label: "Noindex, Follow" },
  { value: "index,nofollow", label: "Index, Nofollow" },
  { value: "noindex,nofollow", label: "Noindex, Nofollow" },
];

const CHARACTER_GUIDES = [
  { field: "seo_title", ideal: 60 },
  { field: "meta_description", ideal: 160 },
];

export default function SeoSettings() {
  const listFetch = useFetch(() => api.seoPages(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<SeoPage>>({});
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const pages: SeoPage[] = listFetch.data?.pages ?? [];

  useEffect(() => {
    if (!selected && pages.length) setSelected(pages[0].path_key);
  }, [pages, selected]);

  // Load the selected page into the form.
  useEffect(() => {
    const page = pages.find((p) => p.path_key === selected);
    if (!page) return;
    setForm({
      path_key: page.path_key,
      label: page.label ?? null,
      seo_title: page.seo_title ?? "",
      meta_description: page.meta_description ?? "",
      keywords: page.keywords ?? "",
      canonical_url: page.canonical_url ?? "",
      robots: page.robots ?? "index,follow",
      og_title: page.og_title ?? "",
      og_description: page.og_description ?? "",
      og_image: page.og_image ?? "",
      json_ld: page.json_ld ?? "",
      in_sitemap: page.in_sitemap !== false,
    });
    setDirty(false);
    setShowJson(false);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        (p.label ?? "").toLowerCase().includes(q) ||
        p.path_key.toLowerCase().includes(q) ||
        (p.path ?? "").toLowerCase().includes(q)
    );
  }, [pages, debounced]);

  if (listFetch.loading) return <Spinner label="Loading SEO settings…" />;
  if (listFetch.error || !listFetch.data) {
    return (
      <EmptyBlock
        title="Couldn't load SEO settings"
        body={listFetch.error ?? "Run supabase/migrations/0008_seo_pages.sql to enable per-page SEO."}
      />
    );
  }

  const set = (k: keyof SeoPage, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const current = pages.find((p) => p.path_key === selected);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSeoPage({
        path_key: form.path_key as string,
        label: form.label ?? null,
        seo_title: form.seo_title || null,
        meta_description: form.meta_description || null,
        keywords: form.keywords || null,
        canonical_url: form.canonical_url || null,
        robots: form.robots || null,
        og_title: form.og_title || null,
        og_description: form.og_description || null,
        og_image: form.og_image || null,
        json_ld: form.json_ld || null,
        in_sitemap: form.in_sitemap !== false,
      });
      toast("SEO saved — applied to the live page immediately");
      setDirty(false);
      listFetch.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "info");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.deleteSeoPage(selected);
      toast("Override cleared — smart defaults restored");
      setConfirmReset(false);
      listFetch.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Reset failed", "info");
    } finally {
      setSaving(false);
    }
  };

  const guideFor = (field: string) => CHARACTER_GUIDES.find((g) => g.field === field)?.ideal;
  const lengthOf = (field: keyof SeoPage) => String(form[field] ?? "").length;

  const jsonValid = (() => {
    const raw = (form.json_ld ?? "").trim();
    if (!raw) return true;
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  })();

  return (
    <div>
      <PageHeader
        title="SEO Settings"
        sub="Per-page overrides for titles, descriptions, Open Graph, structured data and indexing."
        actions={
          <>
            {dirty && current?.overridden && (
              <Btn variant="ghost" icon={RotateCcw} onClick={() => setConfirmReset(true)}>
                Reset to default
              </Btn>
            )}
            <Btn variant="primary" icon={Save} busy={saving} disabled={!dirty || !jsonValid} onClick={save}>
              Save SEO
            </Btn>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── Page picker ── */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fog-600" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages…"
              aria-label="Search pages"
              className="pl-9"
            />
          </div>
          <div className="max-h-[65vh] overflow-y-auto rounded-2xl border border-white/6 bg-ink-900/60 p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-fog-600">No pages match “{query}”.</p>
            ) : (
              filtered.map((page) => (
                <button
                  key={page.path_key}
                  type="button"
                  onClick={() => setSelected(page.path_key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition",
                    selected === page.path_key
                      ? "bg-gradient-to-r from-brand-500/15 to-violet-600/10 text-white ring-1 ring-brand-500/25"
                      : "text-fog-400 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{page.label ?? page.path_key}</span>
                  {page.overridden && (
                    <span
                      title="Has an override"
                      className="size-1.5 shrink-0 rounded-full bg-brand-400"
                      aria-hidden
                    />
                  )}
                </button>
              ))
            )}
          </div>
          <p className="mt-2 px-1 text-[11px] text-fog-600">
            {pages.filter((p) => p.overridden).length} of {pages.length} pages have overrides.
          </p>
        </div>

        {/* ── Editor ── */}
        <div className="min-w-0 space-y-5">
          {!current ? (
            <EmptyBlock title="Select a page" body="Choose a page on the left to edit its SEO." />
          ) : (
            <>
              <section className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white">{current.label}</h2>
                    {current.path && (
                      <a
                        href={current.path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-brand-300 hover:text-brand-400"
                      >
                        {current.path} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                  </div>
                  {current.overridden && (
                    <span className="rounded-md bg-brand-500/12 px-2 py-1 text-[10px] font-semibold text-brand-300">
                      Overridden
                    </span>
                  )}
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label="SEO title"
                    hint={guideFor("seo_title") ? `${lengthOf("seo_title")} / ${guideFor("seo_title")} chars — leave empty to use the smart default` : undefined}
                  >
                    <Input value={form.seo_title ?? ""} onChange={(e) => set("seo_title", e.target.value)} maxLength={200} placeholder="Auto-generated from page content" />
                  </Field>
                  <Field label="Canonical URL" hint="Leave empty for the default self-referencing canonical">
                    <Input value={form.canonical_url ?? ""} onChange={(e) => set("canonical_url", e.target.value)} placeholder="https://erobabe.com/…" />
                  </Field>
                </div>

                <Field
                  label="Meta description"
                  hint={`${lengthOf("meta_description")} / ${guideFor("meta_description")} chars`}
                >
                  <Textarea
                    value={form.meta_description ?? ""}
                    onChange={(e) => set("meta_description", e.target.value)}
                    maxLength={400}
                    className="min-h-20"
                    placeholder="Auto-generated from page content"
                  />
                </Field>

                <Field label="SEO tags / keywords" hint="Comma-separated. Leave empty to use the page's tags.">
                  <Input value={form.keywords ?? ""} onChange={(e) => set("keywords", e.target.value)} placeholder="free adult videos, 18+, hardcore" />
                </Field>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-4">
                  <Field label="Robots directive">
                    <Select
                      value={form.robots ?? "index,follow"}
                      onChange={(e) => set("robots", e.target.value)}
                      aria-label="Robots directive"
                      className="w-56"
                    >
                      {ROBOTS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex items-center gap-3">
                    <Toggle
                      checked={form.in_sitemap !== false}
                      onChange={(v) => set("in_sitemap", v)}
                      label="Include in sitemap"
                    />
                    <span className="text-xs text-fog-500">In sitemap</span>
                  </div>
                </div>
              </section>

              {/* ── Open Graph ── */}
              <section className="space-y-4 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Globe className="size-4 text-brand-400" aria-hidden /> Open Graph
                </h2>
                <p className="text-[11px] leading-relaxed text-fog-500">
                  Controls how this page appears when shared on WhatsApp, Facebook, Telegram and X.
                  Empty fields fall back to the SEO title and description.
                </p>
                <Field label="OG title">
                  <Input value={form.og_title ?? ""} onChange={(e) => set("og_title", e.target.value)} maxLength={200} placeholder="Same as SEO title" />
                </Field>
                <Field label="OG description">
                  <Textarea value={form.og_description ?? ""} onChange={(e) => set("og_description", e.target.value)} maxLength={400} className="min-h-20" placeholder="Same as meta description" />
                </Field>
                <Field label="OG image" hint="Absolute URL, at least 1200×630 for a large preview card.">
                  <Input value={form.og_image ?? ""} onChange={(e) => set("og_image", e.target.value)} placeholder="https://erobabe.com/assets/…" />
                </Field>
                {form.og_image && (
                  <div className="overflow-hidden rounded-xl border border-white/10">
                    <img src={form.og_image} alt="OG image preview" className="aspect-[1.91/1] w-full object-cover" />
                  </div>
                )}
              </section>

              {/* ── JSON-LD ── */}
              <section className="space-y-4 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
                <button
                  type="button"
                  onClick={() => setShowJson((s) => !s)}
                  className="flex w-full items-center gap-2 text-sm font-semibold text-white"
                >
                  <Code2 className="size-4 text-brand-400" aria-hidden />
                  Schema.org / JSON-LD
                  <span className="ml-auto text-[11px] font-normal text-fog-600">
                    {showJson ? "hide" : "show"}
                  </span>
                </button>
                {showJson && (
                  <>
                    <p className="text-[11px] leading-relaxed text-fog-500">
                      Extra structured data merged into this page's schema graph. Validated as JSON
                      before saving — invalid JSON is rejected.
                    </p>
                    <Textarea
                      value={form.json_ld ?? ""}
                      onChange={(e) => set("json_ld", e.target.value)}
                      className="min-h-32 font-mono text-xs"
                      placeholder='{"@type":"FAQPage","mainEntity":[…]}'
                    />
                    {!jsonValid && (
                      <p className="flex items-center gap-2 text-xs font-medium text-red-300">
                        <AlertTriangle className="size-3.5" aria-hidden /> Invalid JSON — fix before saving.
                      </p>
                    )}
                    {jsonValid && (form.json_ld ?? "").trim() && (
                      <p className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                        <Check className="size-3.5" aria-hidden /> Valid JSON
                      </p>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={reset}
        title="Reset SEO override?"
        body="All fields for this page return to the automatically generated values. This cannot be undone."
        confirmLabel="Reset"
        busy={saving}
      />
    </div>
  );
}
