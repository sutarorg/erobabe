import { useState } from "react";
import { BarChart3, Eye, Film, HardDrive, Users, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { BarsChart, EmptyBlock, PageHeader, Select, Spinner, StatCard, Tabs, useFetch, fmtViews, fmtDur, fmtDateTime } from "./ui";
import { fmtBytes } from "./uploader";

function OverviewTab({ days }: { days: number }) {
  const { data, loading, error } = useFetch(() => api.analytics(days), [days]);
  if (loading) return <Spinner label="Loading analytics…" />;
  if (error || !data) return <EmptyBlock title="Couldn't load analytics" body={error ?? undefined} />;

  const rangeTopMap = new Map(data.rangeTop.map((r) => [r.id, r.views]));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Eye} label={`Views (${days}d)`} value={fmtViews(data.rangeViews)} accent />
        <StatCard icon={BarChart3} label="Lifetime views" value={fmtViews(data.storage.lifetimeViews)} />
        <StatCard icon={HardDrive} label="Storage used" value={fmtBytes(data.storage.bytes)} sub={`${data.storage.objects} objects`} />
        <StatCard icon={Film} label="Avg / video" value={fmtViews(data.storage.lifetimeViews ? Math.round(data.storage.lifetimeViews / Math.max(data.storage.objects, 1)) : 0)} />
      </div>

      <div className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Daily views</h2>
        <BarsChart data={data.series} className="h-44" />
      </div>

      <div className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Performing videos</h2>
        {data.topVideos.length === 0 ? (
          <p className="py-8 text-center text-xs text-fog-600">No videos yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/6 text-[11px] uppercase tracking-wider text-fog-600">
                  <th className="py-2.5 pr-3 font-semibold">#</th>
                  <th className="py-2.5 pr-3 font-semibold">Video</th>
                  <th className="py-2.5 pr-3 font-semibold">Views (range)</th>
                  <th className="py-2.5 pr-3 font-semibold">Lifetime</th>
                  <th className="py-2.5 font-semibold">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.topVideos.map((v, i) => (
                  <tr key={v.id}>
                    <td className="py-2.5 pr-3 text-fog-600">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <Link to={`/admin/videos/${v.id}`} className="group flex min-w-0 items-center gap-3">
                        <div className="relative aspect-video w-16 shrink-0 overflow-hidden rounded bg-ink-800 ring-1 ring-white/8">
                          {v.thumbnail_url && <img src={v.thumbnail_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
                        </div>
                        <span className="max-w-52 truncate font-medium text-fog-100 group-hover:text-brand-300">{v.title}</span>
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-fog-300">{fmtViews(rangeTopMap.get(v.id) ?? 0)}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-fog-400">{fmtViews(v.views)}</td>
                    <td className="py-2.5 text-fog-500">{fmtDur(v.duration_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityTab() {
  const { data, loading, error } = useFetch(() => api.activity(100), []);
  if (loading) return <Spinner label="Loading activity…" />;
  if (error || !data) return <EmptyBlock title="Couldn't load activity" body={error ?? undefined} />;
  const items = data.activity;

  return (
    <div className="rounded-2xl border border-white/6 bg-ink-900/60 p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Clock className="size-4 text-brand-400" aria-hidden />
        Audit log — latest {items.length} events
      </h2>
      {items.length === 0 ? (
        <EmptyBlock icon={Users} title="No activity yet" body="Sign-ins, uploads, edits and publishes are recorded here." />
      ) : (
        <ul className="divide-y divide-white/5">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
              <span className="rounded-md bg-white/6 px-2 py-0.5 text-xs font-semibold text-fog-200">{a.actor}</span>
              <span className="rounded-md bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-300">{a.action}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-fog-500">
                {a.entity}
                {typeof a.meta?.title === "string" ? ` · “${a.meta.title}”` : a.entity_id ? ` · ${a.entity_id.slice(0, 8)}…` : ""}
              </span>
              <span className="text-[11px] tabular-nums text-fog-600">{fmtDateTime(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Analytics() {
  const [tab, setTab] = useState("overview");
  const [days, setDays] = useState(14);
  return (
    <div>
      <PageHeader
        title="Analytics"
        sub="Real view tracking from the public site."
        actions={
          tab === "overview" ? (
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range" className="w-36">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </Select>
          ) : undefined
        }
      />
      <Tabs tabs={[{ key: "overview", label: "Overview" }, { key: "activity", label: "Activity log" }]} active={tab} onChange={setTab} />
      {tab === "overview" ? <OverviewTab days={days} /> : <ActivityTab />}
    </div>
  );
}
