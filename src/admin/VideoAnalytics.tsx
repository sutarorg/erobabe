import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, BarChart3, Clock, Eye, Gauge, Globe, Heart, MonitorSmartphone,
  MousePointerClick, Repeat, Search, Share2, ThumbsUp, Users,
} from "lucide-react";
import { api, type Share } from "./api";
import {
  Btn, EmptyBlock, PageHeader, Select, Spinner, StatCard, useFetch, fmtViews, fmtDur, fmtDate,
} from "./ui";
import { ViewsChart } from "./Chart";
import { cn } from "@/lib/format";

const pct = (n: number) => `${Math.round(n * 100)}%`;

const SOURCE_META: Record<string, { label: string; icon: typeof Globe; color: string }> = {
  direct: { label: "Direct", icon: Globe, color: "from-sky-500 to-sky-400" },
  search: { label: "Search", icon: Search, color: "from-emerald-500 to-emerald-400" },
  social: { label: "Social", icon: Share2, color: "from-brand-500 to-violet-500" },
  referral: { label: "Referral", icon: Repeat, color: "from-amber-500 to-amber-400" },
  internal: { label: "On-site", icon: MonitorSmartphone, color: "from-zinc-500 to-zinc-400" },
};

/** Horizontal share bars used across the discovery / audience panels. */
export function ShareBars({ items, empty = "No data yet." }: { items: Share[]; empty?: string }) {
  if (!items.length) return <p className="py-6 text-center text-xs text-fog-600">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const meta = SOURCE_META[item.name];
        const Icon = meta?.icon;
        return (
          <li key={item.name}>
            <div className="mb-1 flex items-center gap-2 text-xs">
              {Icon && <Icon className="size-3.5 shrink-0 text-fog-500" aria-hidden />}
              <span className="min-w-0 flex-1 truncate font-medium capitalize text-fog-200">
                {meta?.label ?? item.name}
              </span>
              <span className="shrink-0 tabular-nums text-fog-500">
                {item.count.toLocaleString()} <span className="text-fog-600">· {pct(item.share)}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
              <div
                className={cn("h-full rounded-full bg-gradient-to-r", meta?.color ?? "from-brand-500 to-violet-500")}
                style={{ width: `${Math.max((item.count / max) * 100, 2)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Panel({ title, icon: Icon, children, className }: {
  title: string; icon: typeof Eye; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-white/6 bg-ink-900/60 p-5", className)}>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Icon className="size-4 text-brand-400" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Retention curve — share of sessions still watching at each decile. */
function RetentionCurve({ points, duration }: { points: { pct: number; share: number }[]; duration: number }) {
  const W = 560;
  const H = 150;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const xy = points.map((p, i) => ({
    x: pad.l + (i / Math.max(points.length - 1, 1)) * iw,
    y: pad.t + ih * (1 - p.share),
    ...p,
  }));
  const line = xy.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area = `${line} L ${xy[xy.length - 1]?.x ?? pad.l} ${pad.t + ih} L ${pad.l} ${pad.t + ih} Z`;
  const hasData = points.some((p) => p.share > 0);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Audience retention curve">
        <defs>
          <linearGradient id="eb-ret" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f7f" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={pad.l + iw} y1={pad.t + ih * f} y2={pad.t + ih * f} stroke="rgba(255,255,255,0.07)" />
            <text x={pad.l - 8} y={pad.t + ih * f + 3} textAnchor="end" className="fill-fog-600" style={{ fontSize: 9 }}>
              {Math.round((1 - f) * 100)}%
            </text>
          </g>
        ))}
        {hasData && (
          <>
            <path d={area} fill="url(#eb-ret)" />
            <path d={line} fill="none" stroke="#fb6fa8" strokeWidth={2} strokeLinecap="round" />
          </>
        )}
        {[0, 25, 50, 75, 100].map((p) => (
          <text
            key={p}
            x={pad.l + (p / 100) * iw}
            y={H - 6}
            textAnchor={p === 0 ? "start" : p === 100 ? "end" : "middle"}
            className="fill-fog-600"
            style={{ fontSize: 9 }}
          >
            {duration ? fmtDur(Math.round((p / 100) * duration)) : `${p}%`}
          </text>
        ))}
      </svg>
      {!hasData && (
        <p className="absolute inset-0 grid place-items-center text-xs text-fog-600">
          Retention appears once viewers watch this video.
        </p>
      )}
    </div>
  );
}

export default function VideoAnalytics() {
  const { id } = useParams();
  const [days, setDays] = useState(30);
  const { data, loading, error } = useFetch(() => api.videoAnalytics(id!, days), [id, days]);

  if (loading) return <Spinner label="Loading video analytics…" />;
  if (error || !data) {
    return (
      <EmptyBlock
        title="Couldn't load analytics"
        body={error ?? undefined}
        action={<Btn variant="subtle" onClick={() => window.location.reload()}>Retry</Btn>}
      />
    );
  }

  const { video, performance: perf, engagement, retention, series, discovery, audience } = data;
  const halfway = retention.find((r) => r.pct === 50)?.share ?? 0;

  return (
    <div>
      <PageHeader
        title={video.title}
        sub={`Published ${fmtDate(video.published_at ?? video.created_at)} · ${fmtDur(video.duration_s)}`}
        actions={
          <>
            <Link
              to={`/admin/videos/${video.id}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fog-400 hover:text-white"
            >
              <ArrowLeft className="size-4" aria-hidden /> Edit video
            </Link>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range" className="w-36">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </Select>
          </>
        }
      />

      {/* ── Performance ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard icon={Eye} label={`Views (${days}d)`} value={fmtViews(perf.rangeViews)} sub={`${fmtViews(perf.lifetimeViews)} lifetime`} accent />
        <StatCard icon={Users} label="Unique viewers" value={fmtViews(perf.uniqueViewers)} sub={`${pct(perf.repeatRate)} repeat`} />
        <StatCard icon={Clock} label="Avg watch time" value={fmtDur(Math.round(perf.avgWatchSeconds))} sub={`${fmtDur(Math.round(perf.totalWatchSeconds))} total`} />
        <StatCard icon={Gauge} label="Avg completion" value={`${Math.round(perf.avgCompletion)}%`} sub={`${perf.trackedSessions} tracked`} />
        <StatCard icon={MonitorSmartphone} label="Impressions" value={perf.impressions == null ? "—" : fmtViews(perf.impressions)} sub="times shown" />
        <StatCard icon={MousePointerClick} label="CTR" value={`${perf.ctr.toFixed(2)}%`} sub={`${fmtViews(perf.clicks ?? 0)} clicks`} />
      </div>

      <div className="mt-6 space-y-6">
        <ViewsChart data={series} title="Views over time" subtitle={`${days} days`} height={250} />

        {/* ── Retention ── */}
        <Panel title="Audience retention" icon={BarChart3}>
          <RetentionCurve points={retention} duration={video.duration_s} />
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/6 pt-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <p className="text-fog-600">Reached halfway</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{pct(halfway)}</p>
            </div>
            <div>
              <p className="text-fog-600">Impressions</p>
              <p className="mt-0.5 text-sm font-semibold text-white">
                {perf.impressions == null ? "—" : fmtViews(perf.impressions)}
              </p>
            </div>
            <div>
              <p className="text-fog-600">Click-through rate</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{perf.ctr.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-fog-600">Watched to end</p>
              <p className="mt-0.5 text-sm font-semibold text-white">
                {pct(retention.find((r) => r.pct === 100)?.share ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-fog-600">Avg view duration</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{fmtDur(Math.round(perf.avgWatchSeconds))}</p>
            </div>
          </div>
        </Panel>

        {/* ── Discovery + Audience ── */}
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <Panel title="Discovery — how viewers arrive" icon={Search}>
            <ShareBars items={discovery.sources} empty="Traffic sources appear after the next views." />
            {discovery.referrers.length > 0 && (
              <>
                <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wider text-fog-600">
                  Top referrers
                </p>
                <ShareBars items={discovery.referrers} />
              </>
            )}
          </Panel>

          <Panel title="Audience — devices" icon={MonitorSmartphone}>
            <ShareBars items={audience.devices} empty="Device data appears after the next views." />
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/6 pt-4 text-xs">
              <div>
                <p className="text-fog-600">Unique viewers</p>
                <p className="mt-0.5 text-sm font-semibold text-white">{fmtViews(perf.uniqueViewers)}</p>
              </div>
              <div>
                <p className="text-fog-600">Views / viewer</p>
                <p className="mt-0.5 text-sm font-semibold text-white">
                  {perf.uniqueViewers ? (perf.rangeViews / perf.uniqueViewers).toFixed(2) : "—"}
                </p>
              </div>
            </div>
          </Panel>
        </div>

        {/* ── Engagement ── */}
        <Panel title="Engagement" icon={Heart}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={ThumbsUp} label="Likes" value={fmtViews(engagement.likes)} />
            <StatCard icon={Heart} label="Engagement rate" value={pct(engagement.engagementRate)} sub="likes ÷ views" />
            <StatCard icon={BarChart3} label="Views / day" value={engagement.viewsPerDay.toFixed(1)} sub={`over ${days} days`} />
            <StatCard icon={Gauge} label="Like ratio" value={`${Math.round(engagement.likeRatio)}%`} />
          </div>
          {video.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/6 pt-4">
              {video.tags.map((t) => (
                <span key={t} className="rounded-md bg-white/6 px-2 py-1 text-[11px] text-fog-300">{t}</span>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
