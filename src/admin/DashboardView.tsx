import {
  Activity, ArrowRight, BadgeCheck, Banknote, Bell, Building2, Clapperboard,
  Eye, Layers, Megaphone, TrendingUp, Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, Card, IconBox, Select } from "../portal/ui";
import { cn } from "../utils/cn";
import type {
  AdminSlot, AdminVideo, Notice, Report, VideoStatus,
} from "./data";
import { REVENUE, REVENUE_SPARK, VIEWS_SPARK } from "./data";
import type { AdminView } from "./AdminSidebar";
import VideosTable from "./VideosTable";
import { AdminBadge, RevenueChart, Sparkline, TH_CLASS } from "./widgets";

/* ------------------------------ types ------------------------------ */

interface DashboardViewProps {
  videos: AdminVideo[];
  slots: AdminSlot[];
  reports: Report[];
  notices: Notice[];
  advertiserCount: number;
  onNavigate: (view: AdminView) => void;
  onPreviewVideo: (v: AdminVideo) => void;
  onEditVideo: (v: AdminVideo) => void;
  onDuplicateVideo: (v: AdminVideo) => void;
  onToggleVideoStatus: (v: AdminVideo) => void;
  onOpenSlot: (slot: AdminSlot) => void;
  onOpenReport: (report: Report) => void;
  onQuickAd: () => void;
  onQuickSlot: () => void;
  onQuickAdvertiser: () => void;
  onMarkAllRead: () => void;
}

type VideoTab = "all" | VideoStatus;

const TABS: { key: VideoTab; label: string }[] = [
  { key: "all", label: "All Videos" },
  { key: "published", label: "Published" },
  { key: "draft", label: "Drafts" },
  { key: "processing", label: "Processing" },
  { key: "unpublished", label: "Unpublished" },
];

/* ---------------------- dashboard insight cards --------------------- */

const parseViews = (v: string): number => {
  if (!v || v === "—") return 0;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return v.includes("M") ? n * 1e6 : v.includes("K") ? n * 1e3 : n;
};

/** Most-watched published videos, ranked with a share-of-peak bar. */
function TopPerforming({
  videos,
  onOpen,
  onViewAll,
}: {
  videos: AdminVideo[];
  onOpen: (v: AdminVideo) => void;
  onViewAll: () => void;
}) {
  const top = useMemo(
    () =>
      [...videos]
        .filter((v) => v.status === "published")
        .sort((a, b) => parseViews(b.views) - parseViews(a.views))
        .slice(0, 5),
    [videos]
  );
  const peak = parseViews(top[0]?.views ?? "0") || 1;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold tracking-tight text-ink">
          Top Performing Videos
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="text-[11.5px] font-semibold text-accent transition-colors hover:text-accent-soft"
        >
          View all
        </button>
      </div>
      <div className="mt-1 divide-y divide-line/60">
        {top.map((v, i) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onOpen(v)}
            className="flex w-full items-center gap-3 py-2.5 text-left"
          >
            <span className="w-3 shrink-0 text-[11px] font-semibold tabular-nums text-ink-3">
              {i + 1}
            </span>
            <img
              src={v.thumb}
              alt=""
              draggable={false}
              className="h-9 w-16 shrink-0 rounded-md border border-line object-cover"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink">{v.title}</span>
              <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-void">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(8, (parseViews(v.views) / peak) * 100)}%` }}
                />
              </span>
            </span>
            <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-ink-2">
              {v.views}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ---------------------------- dashboard ---------------------------- */

export default function DashboardView(props: DashboardViewProps) {
  const {
    videos, slots, reports, notices, advertiserCount,
    onNavigate, onPreviewVideo, onEditVideo, onDuplicateVideo, onToggleVideoStatus,
    onOpenSlot, onOpenReport, onQuickAd, onQuickSlot, onQuickAdvertiser,
    onMarkAllRead,
  } = props;

  const [tab, setTab] = useState<VideoTab>("all");
  const [notifOpen, setNotifOpen] = useState(false);
  const [revKey, setRevKey] = useState<keyof typeof REVENUE>("month");

  const unread = notices.filter((n) => n.unread).length;

  const filtered = useMemo(
    () => videos.filter((v) => tab === "all" || v.status === tab).slice(0, 6),
    [videos, tab]
  );
  const counts = useMemo(() => {
    const map: Record<string, number> = { all: videos.length };
    videos.forEach((v) => { map[v.status] = (map[v.status] ?? 0) + 1; });
    return map;
  }, [videos]);

  const kpis = [
    { icon: Clapperboard, label: "Total Videos", value: "1,248", growth: "+4.2%" },
    { icon: Eye, label: "Total Views", value: "3.24M", growth: "+12.4%", spark: VIEWS_SPARK },
    { icon: Megaphone, label: "Active Campaigns", value: "32", growth: "+6.0%" },
    { icon: Banknote, label: "Monthly Revenue", value: "$9,842.50", growth: "+9.1%", spark: REVENUE_SPARK },
    {
      icon: Building2,
      label: "Advertisers",
      value: String(advertiserCount),
      action: "View all",
      onAction: () => onNavigate("advertisers"),
    },
  ];

  const quickActions = [
    { icon: Upload, label: "Upload Video", fn: () => onNavigate("upload") },
    { icon: Megaphone, label: "Add Advertisement", fn: onQuickAd },
    { icon: Layers, label: "Create Ad Slot", fn: onQuickSlot },
    { icon: Building2, label: "Add Advertiser", fn: onQuickAdvertiser },
    { icon: Activity, label: "View Reports", fn: () => onNavigate("reports") },
  ];

  const rev = REVENUE[revKey];

  return (
    <div>
      {/* header */}
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <p className="text-[11.5px] text-ink-3">Welcome back,</p>
          <h1 className="mt-0.5 flex items-center gap-1.5 text-[20px] font-semibold tracking-tight text-ink">
            Admin
            <BadgeCheck className="h-4 w-4 shrink-0 text-accent" aria-label="Verified administrator" />
          </h1>
          <p className="mt-0.5 text-[11.5px] text-ink-3">Here&apos;s what&apos;s happening with Erobabe today.</p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Select label="Date range" defaultValue="month">
            <option value="month">Dec 01 – Dec 14, 2026</option>
            <option value="last">Nov 01 – Nov 30, 2026</option>
            <option value="qtr">Oct 01 – Dec 14, 2026</option>
          </Select>

          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              aria-expanded={notifOpen}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-pcard text-ink-2 transition-colors hover:border-zinc-500 hover:text-ink"
            >
              <Bell className="h-4 w-4" aria-hidden />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} aria-hidden />
                <div className="eb-panel absolute right-0 top-full z-50 mt-2 w-[292px] rounded-xl border border-line bg-pcard-2 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-[11.5px] font-semibold text-ink">Notifications</span>
                    <button type="button" onClick={onMarkAllRead} className="text-[10.5px] font-medium text-accent hover:text-accent-soft">
                      Mark all read
                    </button>
                  </div>
                  {notices.map((n) => (
                    <div key={n.id} className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]">
                      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", n.unread ? "bg-accent" : "bg-transparent")} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[12px] font-medium text-ink">{n.title}</span>
                          <span className="shrink-0 text-[10px] text-ink-3">{n.time}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-ink-3">{n.body}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden text-right sm:block">
              <p className="text-[12.5px] font-medium leading-tight text-ink">Admin User</p>
              <p className="text-[10.5px] text-ink-3">Super Administrator</p>
            </div>
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-[11px] font-bold text-accent">
              AU
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-void" aria-label="Online" />
            </span>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="p-3.5">
              <div className="flex items-start justify-between">
                <IconBox>
                  <Icon className="h-4 w-4" aria-hidden />
                </IconBox>
                {"action" in kpi && kpi.action ? (
                  <button type="button" onClick={kpi.onAction} className="text-[10.5px] font-semibold text-accent hover:text-accent-soft">
                    {kpi.action}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-400">
                    <TrendingUp className="h-2.5 w-2.5" aria-hidden />
                    {kpi.growth}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <p className="text-[20px] font-semibold tabular-nums tracking-tight text-ink">{kpi.value}</p>
                {"spark" in kpi && kpi.spark && <Sparkline points={kpi.spark} />}
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-ink-3">{kpi.label}</p>
            </Card>
          );
        })}
        {/* System status card */}
        <Card className="p-3.5">
          <div className="flex items-start justify-between">
            <IconBox className="!border-emerald-500/25 !bg-emerald-500/10 !text-emerald-400">
              <Activity className="h-4 w-4" aria-hidden />
            </IconBox>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden /> Healthy
            </span>
          </div>
          <p className="mt-3 text-[20px] font-semibold tracking-tight text-ink">Healthy</p>
          <p className="mt-0.5 text-[11px] font-medium text-ink-3">System Status</p>
          <p className="mt-0.5 text-[10px] text-ink-3/80">All systems operational.</p>
        </Card>
      </div>

      {/* main grid */}
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.45fr_1fr]">
        {/* left */}
        <div className="min-w-0">
          <Card>
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
              <h2 className="text-[14px] font-semibold tracking-tight text-ink">Recent Videos</h2>
              <button type="button" onClick={() => onNavigate("videos")} className="ml-auto text-[11.5px] font-semibold text-accent hover:text-accent-soft">
                View all videos
              </button>
            </div>
            <div className="px-4 pt-3">
              <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-line bg-pcard p-1" role="tablist" aria-label="Filter videos by status">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "flex h-6.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
                      tab === t.key ? "bg-white/[0.07] text-ink" : "text-ink-3 hover:text-ink-2"
                    )}
                  >
                    {t.label}
                    <span className={cn("text-[9.5px] tabular-nums", tab === t.key ? "text-accent" : "text-ink-3")}>
                      {t.key === "all" ? counts.all : counts[t.key] ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-1">
              <VideosTable
                videos={filtered}
                onPreview={onPreviewVideo}
                onEdit={onEditVideo}
                onDuplicate={onDuplicateVideo}
                onToggleStatus={onToggleVideoStatus}
              />
            </div>
          </Card>

          <div className="mt-5">
            <TopPerforming
              videos={videos}
              onOpen={onPreviewVideo}
              onViewAll={() => onNavigate("videos")}
            />
          </div>
        </div>

        {/* right */}
        <div className="min-w-0">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold tracking-tight text-ink">Ad Slots Overview</h2>
              <button type="button" onClick={() => onNavigate("slots")} className="text-[11.5px] font-semibold text-accent hover:text-accent-soft">
                View all slots
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4">
              {slots.slice(0, 10).map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => onOpenSlot(slot)}
                  className="group flex items-center gap-2 border-b border-line/60 py-2 text-left transition-colors last:border-0 hover:bg-transparent"
                >
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-accent/40 text-[9.5px] font-semibold text-accent">
                    {slot.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-ink">{slot.name}</span>
                    <span className="block truncate text-[9.5px] text-ink-3">
                      {slot.status === "active" ? slot.advertiser ?? "—" : "Vacant"}
                    </span>
                  </span>
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", slot.status === "active" ? "bg-emerald-400" : "bg-zinc-600")} aria-hidden />
                  <ArrowRight className="h-3 w-3 shrink-0 text-ink-3 transition-colors group-hover:text-accent" aria-hidden />
                </button>
              ))}
            </div>
          </Card>

          {/* quick actions */}
          <Card className="mt-5 p-4">
            <h2 className="text-[14px] font-semibold tracking-tight text-ink">Quick Actions</h2>
            <div className="mt-3 space-y-2">
              {quickActions.map((qa) => {
                const Icon = qa.icon;
                return (
                  <button
                    key={qa.label}
                    type="button"
                    onClick={qa.fn}
                    className="group flex h-10 w-full items-center gap-2.5 rounded-lg border border-line px-3 text-left transition-colors hover:border-accent/50"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
                    <span className="text-[12.5px] font-medium text-ink">{qa.label}</span>
                    <ArrowRight className="ml-auto h-3.5 w-3.5 text-ink-3 transition-colors group-hover:text-accent" aria-hidden />
                  </button>
                );
              })}
            </div>
          </Card>

          {/* revenue — sits in the right column so no empty space is left
              under Quick Actions */}
          <Card className="mt-5 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold tracking-tight text-ink">Revenue Overview</h2>
              <Select label="Revenue period" value={revKey} onChange={(e) => setRevKey(e.target.value as keyof typeof REVENUE)}>
                <option value="month">This Month</option>
                <option value="last">Last Month</option>
                <option value="qtr">This Quarter</option>
              </Select>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: "Total Revenue", value: rev.total },
                { label: "Ad Revenue", value: rev.ad },
                { label: "Other Revenue", value: rev.other },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-line bg-pcard px-2.5 py-2">
                  <p className="text-[9px] font-medium uppercase tracking-wider text-ink-3">{s.label}</p>
                  <p className="mt-0.5 text-[13.5px] font-semibold tabular-nums text-ink">{s.value}</p>
                </div>
              ))}
            </div>

            <RevenueChart data={rev.data} labels={rev.labels} />

            <Btn variant="outline" className="mt-3 w-full" onClick={() => onNavigate("payments")}>
              View financial reports
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Btn>
          </Card>
        </div>
      </div>

      {/* reports — full width beneath both columns */}
      <div className="mt-5">
        <Card>
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-[14px] font-semibold tracking-tight text-ink">Recent Reports</h2>
            <button type="button" onClick={() => onNavigate("reports")} className="text-[11.5px] font-semibold text-accent hover:text-accent-soft">
              View all
            </button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-line">
                  {["Type", "Reason", "Content", "Reported By", "Date", "Status"].map((h) => (
                    <th key={h} className={TH_CLASS}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {reports.slice(0, 5).map((r) => (
                  <tr key={r.id} onClick={() => onOpenReport(r)} className="cursor-pointer transition-colors hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11.5px] font-medium text-ink-2">{r.type}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11.5px] text-ink-2">{r.reason}</td>
                    <td className="max-w-[160px] truncate px-4 py-2.5 text-[11.5px] text-ink">{r.content}</td>
                    <td className="px-4 py-2.5 text-[11.5px] text-ink-3">{r.reportedBy}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-ink-3">{r.date}</td>
                    <td className="px-4 py-2.5"><AdminBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* footer */}
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[11px] text-ink-3">
        <span>© 2025 Erobabe. All rights reserved.</span>
        <span>18+ Adults only content.</span>
      </footer>
    </div>
  );
}
