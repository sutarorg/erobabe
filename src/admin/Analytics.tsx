import { useState } from "react";
import {
  BarChart3, Eye, Film, Globe, HardDrive, MonitorSmartphone, Repeat,
  Search, Share2, Users, Clock, Trophy,
} from "lucide-react";
import { ShareBars } from "./VideoAnalytics";
import { Link } from "react-router-dom";
import { api } from "./api";
import { EmptyBlock, PageHeader, Select, Spinner, StatCard, Tabs, useFetch, fmtViews, fmtDur, fmtDateTime } from "./ui";
import { ViewsChart, TopBars } from "./Chart";
import { fmtBytes } from "./uploader";

function OverviewTab({ days }: { days: number }) {
  const { data, loading, error } = useFetch(() => api.analytics(days), [days]);
  if (loading) return <Spinner label="Loading analytics…" />;
  if (error || !data) return <EmptyBlock title="Couldn't load analytics" body={error ?? undefined} />;

  const rangeTopMap = new Map(data.rangeTop.map((r) => [r.id, r.views]));
  const avgPerVideo = data.storage.objects
    ? Math.round(data.storage.lifetimeViews / data.storage.objects)
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Eye} label={`Views (${days}d)`} value={fmtViews(data.rangeViews)} accent />
        <StatCard icon={BarChart3} label="Lifetime views" value={fmtViews(data.storage.lifetimeViews)} />
        <StatCard icon={HardDrive} label="Storage used" value={fmtBytes(data.storage.bytes)} sub={`${data.storage.objects} objects`} />
        <StatCard icon={Film} label="Avg / video" value={fmtViews(avgPerVideo)} sub="lifetime" />
      </div>

      <ViewsChart
        data={data.series}
        title="Daily views"
        subtitle={`${days} days`}
        height={280}
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Trophy className="size-4 text-brand-400" aria-hidden />
            Top videos in this period
          </h2>
          <TopBars
            items={data.topVideos
              .map((v) => ({ id: v.id, label: v.title, value: rangeTopMap.get(v.id) ?? 0 }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 8)}
          />
        </section>

        <section className="min-w-0 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <BarChart3 className="size-4 text-brand-400" aria-hidden />
            All-time leaders
          </h2>
          <TopBars items={data.topVideos.slice(0, 8).map((v) => ({ id: v.id, label: v.title, value: v.views }))} />
        </section>
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-white/6 bg-ink-900/60 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Performance detail</h2>
        {data.topVideos.length === 0 ? (
          <p className="py-8 text-center text-xs text-fog-600">No videos yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/6 text-[11px] uppercase tracking-wider text-fog-600">
                  <th className="py-2.5 pr-3 font-semibold">#</th>
                  <th className="py-2.5 pr-3 font-semibold">Video</th>
                  <th className="py-2.5 pr-3 font-semibold">Range</th>
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
      </section>
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

function TrafficTab({ days }: { days: number }) {
  const { data, loading, error } = useFetch(() => api.traffic(days), [days]);
  if (loading) return <Spinner label="Loading traffic…" />;
  if (error || !data) return <EmptyBlock title="Couldn't load traffic" body={error ?? undefined} />;

  if (!data.available) {
    return (
      <EmptyBlock
        icon={Globe}
        title="Traffic analytics not enabled yet"
        body="Run supabase/migrations/0005_traffic_analytics.sql to start recording referral sources, search / social / direct traffic and device data."
      />
    );
  }

  const get = (name: string) => data.sources.find((s) => s.name === name)?.count ?? 0;
  const stacked = data.series.map((d) => ({
    day: d.day,
    views: d.direct + d.search + d.social + d.referral + d.internal,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Globe} label="Direct" value={fmtViews(get("direct"))} sub={`${Math.round(((get("direct")) / (data.total || 1)) * 100)}% of views`} accent />
        <StatCard icon={Search} label="Search" value={fmtViews(get("search"))} sub={`${Math.round(((get("search")) / (data.total || 1)) * 100)}% of views`} />
        <StatCard icon={Share2} label="Social" value={fmtViews(get("social"))} sub={`${Math.round(((get("social")) / (data.total || 1)) * 100)}% of views`} />
        <StatCard icon={Repeat} label="Referral" value={fmtViews(get("referral"))} sub={`${Math.round(((get("referral")) / (data.total || 1)) * 100)}% of views`} />
      </div>

      <ViewsChart data={stacked} title="Attributed views" subtitle={`${days} days`} height={230} />

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Search className="size-4 text-brand-400" aria-hidden /> Traffic channels
          </h2>
          <ShareBars items={data.sources} />
        </section>
        <section className="min-w-0 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Repeat className="size-4 text-brand-400" aria-hidden /> Referral sources
          </h2>
          <ShareBars items={data.referrers} empty="No external referrers recorded yet." />
        </section>
      </div>

      <section className="min-w-0 rounded-2xl border border-white/6 bg-ink-900/60 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <MonitorSmartphone className="size-4 text-brand-400" aria-hidden /> Devices
        </h2>
        <ShareBars items={data.devices} />
      </section>
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
          tab !== "activity" ? (
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range" className="w-36">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </Select>
          ) : undefined
        }
      />
      <Tabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "traffic", label: "Traffic & referrals" },
          { key: "activity", label: "Activity log" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "overview" && <OverviewTab days={days} />}
      {tab === "traffic" && <TrafficTab days={days} />}
      {tab === "activity" && <ActivityTab />}
    </div>
  );
}
