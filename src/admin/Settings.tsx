import { useEffect, useState } from "react";
import { HardDrive, Save, ShieldCheck, Server } from "lucide-react";
import { api, type AdminVideo, type SiteSettings } from "./api";
import {
  Btn, EmptyBlock, Field, Input, PageHeader, Select, Spinner, Textarea, Toggle, useFetch,
} from "./ui";
import { fmtBytes } from "./uploader";
import { toast } from "@/components/Feedback";

export default function Settings() {
  const settingsFetch = useFetch(() => api.settings(), []);
  const publishedFetch = useFetch(() => api.videos({ status: "published", limit: 100, sort: "newest" }), []);
  const overviewFetch = useFetch(() => api.overview(), []);

  const [form, setForm] = useState<SiteSettings>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settingsFetch.data) {
      setForm(settingsFetch.data.settings ?? {});
      setDirty(false);
    }
  }, [settingsFetch.data]);

  if (settingsFetch.loading) return <Spinner label="Loading settings…" />;
  if (settingsFetch.error) return <EmptyBlock title="Couldn't load settings" body={settingsFetch.error} />;

  const published: AdminVideo[] = publishedFetch.data?.items ?? [];
  const storage = overviewFetch.data?.totals;

  const set = (k: keyof SiteSettings, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings({
        siteTitle: form.site_title,
        announcement: form.announcement ?? null,
        heroEnabled: form.hero_enabled !== false,
        featuredVideoId: form.featured_video_id || null,
        ageText: form.age_text ?? null,
      });
      toast("Settings saved — the public site picks them up automatically");
      setDirty(false);
      settingsFetch.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "info");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        sub="Site-wide configuration, applied to the public website immediately."
        actions={<Btn variant="primary" icon={Save} busy={saving} disabled={!dirty} onClick={save}>Save settings</Btn>}
      />

      <div className="space-y-6">
        <section className="space-y-5 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <h2 className="text-sm font-semibold text-white">General</h2>
          <Field label="Site title">
            <Input value={form.site_title ?? ""} onChange={(e) => set("site_title", e.target.value)} maxLength={80} />
          </Field>
          <Field label="Announcement" hint="Optional note shown in public settings surfaces. Leave empty to hide.">
            <Input value={form.announcement ?? ""} onChange={(e) => set("announcement", e.target.value || null)} maxLength={200} placeholder="e.g. New premium collection every Friday" />
          </Field>
          <Field label="Age gate copy (optional override)" hint="Overrides the default 18+ confirmation text.">
            <Textarea value={form.age_text ?? ""} onChange={(e) => set("age_text", e.target.value || null)} maxLength={400} className="min-h-20" />
          </Field>
        </section>

        <section className="space-y-5 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <h2 className="text-sm font-semibold text-white">Homepage</h2>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Hero featured section</p>
              <p className="text-xs text-fog-600">Show the cinematic featured banner on the homepage.</p>
            </div>
            <Toggle checked={form.hero_enabled !== false} onChange={(v) => set("hero_enabled", v)} label="Hero featured section" />
          </div>
          <Field label="Featured video" hint="Pinned to the homepage hero (published videos only).">
            <Select
              value={form.featured_video_id ?? ""}
              onChange={(e) => set("featured_video_id", e.target.value || null)}
              disabled={publishedFetch.loading}
            >
              <option value="">Auto — newest featured flag</option>
              {published.map((v) => (
                <option key={v.id} value={v.id}>{v.title}</option>
              ))}
            </Select>
          </Field>
        </section>

        <section className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white"><Server className="size-4 text-brand-400" aria-hidden /> Infrastructure</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-ink-850 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fog-600"><HardDrive className="size-3.5" aria-hidden /> Storage</p>
              <p className="mt-2 text-lg font-bold text-white">{storage ? fmtBytes(storage.storageBytes) : "—"}</p>
              <p className="text-xs text-fog-600">{storage ? `${storage.objects} tracked objects` : "Loading…"}</p>
            </div>
            <div className="rounded-xl bg-ink-850 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fog-600"><ShieldCheck className="size-3.5" aria-hidden /> Security</p>
              <p className="mt-2 text-xs leading-relaxed text-fog-400">
                Sessions are HttpOnly HMAC cookies · passwords hashed with scrypt · login rate-limited ·
                uploads use short-lived signed URLs · service-role keys never leave the server.
              </p>
            </div>
          </div>
          <p className="mt-4 rounded-xl border border-white/6 bg-ink-850 p-3.5 text-[11px] leading-relaxed text-fog-600">
            Infrastructure is configured with environment variables on your host (Vercel/Netlify):
            SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
            R2_BUCKET, R2_PUBLIC_BASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD_SCRYPT, SESSION_SECRET. See README.md.
          </p>
        </section>
      </div>
    </div>
  );
}
