import {
  Activity, Database, Info, Layers, MonitorPlay, Palette, Server, Settings as SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { Btn, Card, Field, PageHeader, Select, TextArea } from "../portal/ui";
import { cn } from "../utils/cn";
import type { LogEntry, SiteSettings } from "./data";
import { AdminBadge, Switch, TH_CLASS } from "./widgets";

/* ------------------------------ Settings ---------------------------- */

export function SettingsView({
  settings,
  onSave,
}: {
  settings: SiteSettings;
  onSave: (settings: SiteSettings) => void;
}) {
  const [form, setForm] = useState(settings);

  const toggles: { key: keyof SiteSettings; label: string; desc: string }[] = [
    { key: "showViewCounts", label: "Show view counts", desc: "Display public view counters under thumbnails." },
    { key: "autoApprove", label: "Auto-approve reviewed creatives", desc: "Skip manual approval once rights checks pass." },
    { key: "enableComments", label: "Enable comments", desc: "Allow member comments under published videos." },
    { key: "matureWarning", label: "18+ entry warning", desc: "Require visitors to confirm they are adults." },
    { key: "maintenanceMode", label: "Maintenance mode", desc: "Temporarily pause the public site for visitors." },
  ];

  return (
    <div>
      <PageHeader title="Settings" sub="Local interface settings — changes apply to this session only." />

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
            <SettingsIcon className="h-4 w-4 text-accent" aria-hidden /> General
          </h3>
          <div className="mt-4 space-y-4">
            <Field label="Site title" value={form.siteTitle} onChange={(e) => setForm({ ...form, siteTitle: e.target.value })} />
            <TextArea label="Tagline" rows={2} value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Homepage hero" value="Carousel · 3 slides" readOnly hint="Managed in the theme editor (demo)." />
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Default sort</span>
                <Select label="Default sort" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" defaultValue="newest">
                  <option value="newest">Newest first</option>
                  <option value="popular">Most viewed</option>
                  <option value="rated">Highest rated</option>
                </Select>
              </label>
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
              <Layers className="h-4 w-4 text-accent" aria-hidden /> Advertising
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Field
                label="Ad-slot price (USD / month)"
                type="number"
                min={1}
                value={form.slotPrice}
                onChange={(e) => setForm({ ...form, slotPrice: Math.max(1, Number(e.target.value)) })}
              />
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Placement ratio</span>
                <span className="flex h-9 items-center rounded-md border border-line bg-pcard px-3 text-[12.5px] text-ink-3">
                  16:9 — fixed
                </span>
              </label>
            </div>
            <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-3">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
              Price changes here update the mock rate card for this session only — existing
              reservations keep their booked price.
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
              <Palette className="h-4 w-4 text-accent" aria-hidden /> Preferences
            </h3>
            <div className="mt-3 divide-y divide-line/60">
              {toggles.map((t) => (
                <div key={t.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">{t.label}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">{t.desc}</p>
                  </div>
                  <Switch
                    label={t.label}
                    checked={Boolean(form[t.key])}
                    onChange={(v) => setForm({ ...form, [t.key]: v })}
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Btn onClick={() => onSave(form)}>Save settings</Btn>
      </div>
    </div>
  );
}

/* -------------------------------- Logs ------------------------------ */

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [level, setLevel] = useState("all");
  const filtered = logs.filter((l) => level === "all" || l.level === level);

  return (
    <div>
      <PageHeader
        title="Logs"
        sub="Fictional administrative activity from the last days."
        actions={
          <Select label="Filter logs" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </Select>
        }
      />

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["Level", "Timestamp", "Actor", "Action", "Target"].map((h) => (
                  <th key={h} className={TH_CLASS}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filtered.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3"><AdminBadge status={l.level} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11px] tabular-nums text-ink-3">{l.time}</td>
                  <td className="px-4 py-3 text-[11.5px] text-ink-2">{l.actor}</td>
                  <td className="px-4 py-3 text-[11.5px] text-ink">{l.action}</td>
                  <td className="px-4 py-3 text-[11.5px] text-ink-3">{l.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ---------------------------- System Health -------------------------- */

const SERVICES = [
  { name: "Application UI", icon: Activity, latency: "12 ms", uptime: "100.00%", desc: "Public site and portal frontends" },
  { name: "Database", icon: Database, latency: "4 ms", uptime: "99.99%", desc: "Content index (simulated)" },
  { name: "Video Provider", icon: MonitorPlay, latency: "86 ms", uptime: "99.95%", desc: "Streaming & transcode pipeline" },
  { name: "Payments Provider", icon: Server, latency: "132 ms", uptime: "99.98%", desc: "Wallet & card settlements" },
];

export function SystemHealthView() {
  return (
    <div>
      <PageHeader title="System Health" sub="Demonstration status board — no real diagnostics are performed." />

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-line bg-pcard p-3.5 text-[11.5px] leading-relaxed text-ink-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        These indicators are static mock values for the frontend demo. No live checks, pings or
        network requests are executed against any service.
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {SERVICES.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.name} className="p-5">
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <AdminBadge status="healthy" label="Operational" />
              </div>
              <h3 className="mt-3 text-[14px] font-semibold text-ink">{s.name}</h3>
              <p className="mt-0.5 text-[11px] text-ink-3">{s.desc}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line/60 pt-3 text-center">
                {[
                  { label: "Latency", value: s.latency },
                  { label: "Uptime (30d)", value: s.uptime },
                  { label: "Incidents", value: "0" },
                ].map((m) => (
                  <div key={m.label}>
                    <p className="text-[13px] font-semibold tabular-nums text-ink">{m.value}</p>
                    <p className="mt-0.5 text-[9.5px] uppercase tracking-wider text-ink-3">{m.label}</p>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <p className={cn("mt-5 text-[11px] text-ink-3")}>Last checked moments ago · mock telemetry refreshes every 60 seconds (display only).</p>
    </div>
  );
}
