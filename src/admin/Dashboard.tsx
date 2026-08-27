/**
 * Admin dashboard: real store-derived statistics, a views-over-time chart,
 * recent uploads and the activity feed. Exports chart atoms reused by the
 * Analytics page.
 */
import { Link } from "react-router-dom";
import {
  Activity as ActivityIcon, ArrowUpRight, CircleAlert, Clock, Eye, Film,
  Flame, HardDrive, LoaderCircle, Upload,
} from "lucide-react";
import { formatBytes, formatDuration, formatViews } from "../data/videos";
import { useAdmin } from "./store";
import { Card, PageHeader } from "./AdminApp";
import { Button, StatusPill } from "../components/ui";
import { cn } from "../utils/cn";

/* ------------------------------------------------------------------ */

export function AdminDashboard() {
  const { state, events, getVideoUrl } = useAdmin();
  const videos = state.videos;
  const published = videos.filter((v) => v.status === "PUBLISHED");
  const drafts = videos.filter((v) => v.status === "DRAFT" || v.status === "READY");
  const processing = videos.filter((v) => v.status === "PROCESSING");

  const now = Date.now();
  const dayMs = 864e5;
  const viewsToday = events.filter((e) => now - e.ts < dayMs).length;
  const viewsWeek = events.filter((e) => now - e.ts < 7 * dayMs).length;
  const totalViews = videos.reduce((a, v) => a + v.views, 0) + events.length;
  const storage = videos.reduce((a, v) => a + (v.fileSize ?? 0), 0);

  const stats = [
    { label: "Total Videos", value: String(videos.length), icon: Film, tint: "text-eb-rose-soft" },
    { label: "Published", value: String(published.length), icon: Eye, tint: "text-emerald-400" },
    { label: "Drafts", value: String(drafts.length), icon: Clock, tint: "text-sky-400" },
    { label: "Processing", value: String(processing.length), icon: LoaderCircle, tint: "text-amber-400" },
    { label: "Total Views", value: formatViews(totalViews), icon: Flame, tint: "text-eb-rose" },
    { label: "Views Today", value: String(viewsToday), icon: ArrowUpRight, tint: "text-violet-400" },
    { label: "Views This Week", value: String(viewsWeek), icon: ActivityIcon, tint: "text-fuchsia-400" },
    { label: "Storage Used", value: formatBytes(storage), icon: HardDrive, tint: "text-eb-muted" },
  ];

  const recent = [...videos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

  return (
    <div className="anim-fade-up space-y-6">
      <PageHeader
        title="Dashboard"
        sub="Everything happening across EroBabe right now."
        actions={
          <Link to="/admin/videos/new">
            <Button size="sm">
              <Upload size={13} /> Add video
            </Button>
          </Link>
        }
      />

      {/* stat grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold tracking-widest text-eb-faint uppercase">{s.label}</p>
              <s.icon size={14} className={cn("shrink-0", s.tint)} />
            </div>
            <p className="font-display mt-2 text-2xl font-bold text-white">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* chart */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-sm font-bold text-white">Views — last 14 days</h2>
              <p className="mt-0.5 text-[11px] text-eb-faint">Recorded view events (all sources)</p>
            </div>
            <Link to="/admin/analytics" className="ring-focus rounded-full px-2 text-xs font-semibold text-eb-rose-soft hover:text-eb-rose">
              Full analytics
            </Link>
          </div>
          <ViewsChart events={events} days={14} />
        </Card>

        {/* activity */}
        <Card className="flex max-h-[420px] flex-col p-5">
          <h2 className="font-display mb-4 text-sm font-bold text-white">Recent activity</h2>
          <ol className="-mr-2 flex-1 space-y-3 overflow-y-auto pr-2 no-scrollbar">
            {state.activity.slice(0, 14).map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-eb-line bg-eb-800 text-eb-rose-soft">
                  <ActivityIcon size={12} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-eb-text">
                    {a.action} {a.detail && <span className="font-normal text-eb-faint">— {a.detail}</span>}
                  </p>
                  <p className="mt-0.5 text-[10px] text-eb-faint">{relative(a.ts)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* recent uploads */}
      <Card>
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="font-display text-sm font-bold text-white">Recent uploads & edits</h2>
          <Link to="/admin/videos" className="ring-focus rounded-full px-2 text-xs font-semibold text-eb-rose-soft hover:text-eb-rose">
            Open library
          </Link>
        </div>
        <ul className="divide-y divide-eb-line">
          {recent.map((v) => (
            <li key={v.id}>
              <Link to={`/admin/videos/${v.id}/edit`} className="flex items-center gap-4 px-5 py-3 transition hover:bg-white/[0.03]">
                <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-lg bg-eb-800">
                  {v.thumbnail && <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />}
                  <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white">{formatDuration(v.durationSec)}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-eb-text">{v.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-eb-faint">
                    {v.videoUrl || getVideoUrl(v) ? v.fileName ?? "linked source" : "source missing"} • {formatBytes(v.fileSize ?? 0)}
                  </p>
                </div>
                <StatusPill status={v.status} />
                {v.status === "FAILED" && <CircleAlert size={15} className="shrink-0 text-red-400" />}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart atoms (shared with Analytics)                                 */
/* ------------------------------------------------------------------ */

export function bucketEvents(events: { ts: number }[], days: number): number[] {
  const now = Date.now();
  const buckets = Array.from({ length: days }, () => 0);
  for (const e of events) {
    const d = Math.floor((now - e.ts) / 864e5);
    if (d >= 0 && d < days) buckets[days - 1 - d]++;
  }
  return buckets;
}

export function ViewsChart({ events, days, height = 180 }: { events: { ts: number }[]; days: number; height?: number }) {
  const data = bucketEvents(events, days);
  const max = Math.max(4, ...data);
  const w = 100;
  const pts = data.map((v, i) => [ (i / (data.length - 1)) * w, 100 - (v / max) * 92 - 4 ] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w},100 L0,100 Z`;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" style={{ height }} className="w-full" aria-label={`Views over the last ${days} days`} role="img">
        <defs>
          <linearGradient id="ebArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff2d78" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="ebLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff2d78" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75].map((y) => (
          <line key={y} x1="0" y1={100 - y - 4} x2={w} y2={100 - y - 4} stroke="rgba(255,255,255,0.05)" strokeWidth="0.3" />
        ))}
        <path d={area} fill="url(#ebArea)" />
        <path d={line} fill="none" stroke="url(#ebLine)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <div className="mt-1.5 flex justify-between text-[10px] text-eb-faint">
        <span>{days} days ago</span>
        <span>peak {max}/day</span>
        <span>today</span>
      </div>
    </div>
  );
}

export function relative(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
