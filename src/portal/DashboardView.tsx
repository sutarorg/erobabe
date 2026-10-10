import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Bell,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  Eye,
  LayoutGrid,
  Megaphone,
  MousePointerClick,
  Percent,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../utils/cn";
import { fmtUSD, PERF, type Campaign, type Notice, type Profile, type Slot } from "./data";
import PerformanceChart from "./PerformanceChart";
import type { PortalView } from "./Sidebar";
import { Btn, Card, IconBox, Select, StatusPill } from "./ui";

interface DashboardViewProps {
  profile: Profile;
  wallet: number;
  spent: number;
  slots: Slot[];
  campaigns: Campaign[];
  notices: Notice[];
  onNavigate: (view: PortalView) => void;
  onOpenSlot: (slot: Slot) => void;
  onOpenCampaign: (campaign: Campaign) => void;
  onAddFunds: () => void;
  onMarkAllRead: () => void;
}

/* ------------------------------ KPI ------------------------------- */

function Growth({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-400">
      <TrendingUp className="h-2.5 w-2.5" aria-hidden />
      {value}
    </span>
  );
}

/* ------------------------- main component ------------------------- */

export default function DashboardView({
  profile,
  wallet,
  spent,
  slots,
  campaigns,
  notices,
  onNavigate,
  onOpenSlot,
  onOpenCampaign,
  onAddFunds,
  onMarkAllRead,
}: DashboardViewProps) {
  const [posFilter, setPosFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notifOpen, setNotifOpen] = useState(false);
  const [perfKey, setPerfKey] = useState<keyof typeof PERF>("month");

  const unread = notices.filter((n) => n.unread).length;
  const activeCount = campaigns.filter((c) => c.status === "active").length;

  const filteredSlots = useMemo(
    () =>
      slots.filter(
        (s) =>
          (posFilter === "all" || s.side === posFilter) &&
          (statusFilter === "all" || s.status === statusFilter)
      ),
    [slots, posFilter, statusFilter]
  );

  const kpis = [
    {
      icon: Megaphone, label: "Active Campaigns", value: String(activeCount),
      action: { label: "View all", fn: () => onNavigate("campaigns") },
    },
    { icon: Eye, label: "Total Impressions", value: "812.4K", growth: "+18.2%", support: "increased this month" },
    { icon: MousePointerClick, label: "Total Clicks", value: "12.6K", growth: "+9.6%", support: "increased this month" },
    { icon: Percent, label: "CTR", value: "1.55%", growth: "+6.9%", support: "increased this month" },
    {
      icon: Banknote, label: "Amount Spent", value: fmtUSD(spent),
      action: { label: "View invoices", fn: () => onNavigate("invoices") },
    },
    {
      icon: Wallet, label: "Available Balance", value: fmtUSD(wallet),
      action: { label: "Add funds", fn: onAddFunds },
    },
  ];

  const quickActions = [
    { icon: CirclePlus, title: "Create Campaign", desc: "Launch a new ad campaign.", fn: () => onNavigate("create") },
    { icon: LayoutGrid, title: "Browse Ad Slots", desc: "View available ad placements.", fn: () => onNavigate("slots") },
    { icon: Wallet, title: "Add Funds", desc: "Top up your account balance.", fn: onAddFunds },
    { icon: ReceiptText, title: "View Invoices", desc: "Download payment invoices.", fn: () => onNavigate("invoices") },
  ];

  const perf = PERF[perfKey];

  return (
    <div>
      {/* ------------------------- header ------------------------- */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0">
          <p className="text-[11.5px] text-ink-3">Welcome back,</p>
          <h1 className="mt-0.5 flex items-center gap-1.5 text-[20px] font-semibold tracking-tight text-ink">
            {profile.company}
            <BadgeCheck className="h-4 w-4 shrink-0 text-accent" aria-label="Verified advertiser" />
          </h1>
          <p className="mt-0.5 text-[11.5px] text-ink-3">Track, manage and grow your campaigns.</p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* Wallet */}
          <div className="flex items-center gap-3 rounded-xl border border-line bg-pcard px-3.5 py-2.5">
            <IconBox>
              <Wallet className="h-4 w-4" aria-hidden />
            </IconBox>
            <div className="mr-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Wallet Balance</p>
              <p className="text-[15px] font-semibold tabular-nums leading-tight text-ink">
                {fmtUSD(wallet)}
              </p>
            </div>
            <Btn size="sm" onClick={onAddFunds}>Add Funds</Btn>
          </div>

          {/* Notifications */}
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
                    <button
                      type="button"
                      onClick={onMarkAllRead}
                      className="text-[10.5px] font-medium text-accent hover:text-accent-soft"
                    >
                      Mark all read
                    </button>
                  </div>
                  {notices.map((n) => (
                    <div
                      key={n.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          n.unread ? "bg-accent" : "bg-transparent"
                        )}
                      />
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

          {/* Account */}
          <div className="flex items-center gap-2.5">
            <div className="hidden text-right sm:block">
              <p className="text-[12.5px] font-medium leading-tight text-ink">{profile.company}</p>
              <p className="text-[10.5px] text-ink-3">Advertiser</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-[11px] font-bold text-accent">
              {profile.company.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------- KPI row ------------------------ */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="p-3.5">
              <div className="flex items-start justify-between">
                <IconBox>
                  <Icon className="h-4 w-4" aria-hidden />
                </IconBox>
                {"growth" in kpi && kpi.growth ? (
                  <Growth value={kpi.growth} />
                ) : "action" in kpi && kpi.action ? (
                  <button
                    type="button"
                    onClick={kpi.action.fn}
                    className="text-[10.5px] font-semibold text-accent transition-colors hover:text-accent-soft"
                  >
                    {kpi.action.label}
                  </button>
                ) : null}
              </div>
              <p className="mt-3 text-[20px] font-semibold tabular-nums tracking-tight text-ink">
                {kpi.value}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-ink-3">{kpi.label}</p>
              {"support" in kpi && kpi.support && (
                <p className="mt-0.5 text-[10px] text-ink-3/80">{kpi.support}</p>
              )}
            </Card>
          );
        })}
      </div>

      {/* ---------------------- content grid ---------------------- */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1.58fr_1fr]">
        {/* left column */}
        <div className="min-w-0">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold tracking-tight text-ink">Ad Slots Overview</h2>
              <div className="ml-auto flex items-center gap-2">
                <Select label="Filter by position" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
                  <option value="all">All Positions</option>
                  <option value="left">Left Rail</option>
                  <option value="right">Right Rail</option>
                </Select>
                <Select label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="available">Available</option>
                </Select>
              </div>
            </div>

            <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
              {filteredSlots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => onOpenSlot(slot)}
                  className="group flex items-center gap-2.5 rounded-lg border border-line bg-pcard-2 px-2.5 py-2.5 text-left transition-colors hover:border-accent/45"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/8 text-[10px] font-semibold text-accent">
                    {slot.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-ink">{slot.name}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">
                      16:9 · {slot.status === "active" ? slot.campaignName ?? slot.advertiser : "Vacant"}
                      {slot.status === "active" && slot.start ? ` · ${slot.start}–${slot.end}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        slot.status === "active" ? "bg-emerald-400" : "bg-zinc-600"
                      )}
                    />
                    <span
                      className={cn(
                        "text-[10.5px] font-medium",
                        slot.status === "active" ? "text-emerald-400" : "text-ink-3"
                      )}
                    >
                      {slot.status === "active" ? "Active" : "Available"}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-colors group-hover:text-accent"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            {filteredSlots.length === 0 && (
              <p className="mt-3.5 rounded-lg border border-dashed border-line py-6 text-center text-[12px] text-ink-3">
                No placements match these filters.
              </p>
            )}

            <Btn variant="outline" className="mt-3.5 w-full" onClick={() => onNavigate("slots")}>
              View All Ad Slots
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Btn>
          </Card>

          {/* Quick actions */}
          <h2 className="mt-5 text-[14px] font-semibold tracking-tight text-ink">Quick Actions</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {quickActions.map((qa) => {
              const Icon = qa.icon;
              return (
                <button
                  key={qa.title}
                  type="button"
                  onClick={qa.fn}
                  className="group rounded-xl border border-line bg-pcard p-3.5 text-left transition-colors hover:border-accent/45"
                >
                  <IconBox className="h-9 w-9">
                    <Icon className="h-4 w-4" aria-hidden />
                  </IconBox>
                  <p className="mt-2.5 text-[12.5px] font-semibold text-ink">{qa.title}</p>
                  <p className="mt-1 text-[11px] leading-snug text-ink-3">{qa.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* right column */}
        <div className="min-w-0">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold tracking-tight text-ink">Recent Campaigns</h2>
              <button
                type="button"
                onClick={() => onNavigate("campaigns")}
                className="text-[11.5px] font-semibold text-accent transition-colors hover:text-accent-soft"
              >
                View all
              </button>
            </div>
            <div className="mt-1 divide-y divide-line/60">
              {campaigns.slice(0, 4).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenCampaign(c)}
                  className="group flex w-full items-center gap-3 py-3 text-left"
                >
                  <img
                    src={c.thumb}
                    alt=""
                    draggable={false}
                    className="h-9 w-16 shrink-0 rounded-md border border-line object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{c.name}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">
                      Slot {c.slotId} · {c.placement}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">
                      {c.start.split(",")[0]} – {c.end.split(",")[0]}
                    </span>
                  </span>
                  <StatusPill status={c.status} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 transition-colors group-hover:text-accent" aria-hidden />
                </button>
              ))}
            </div>
          </Card>

          <Card className="mt-5 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold tracking-tight text-ink">Campaign Performance</h2>
              <Select
                label="Performance period"
                value={perfKey}
                onChange={(e) => setPerfKey(e.target.value as keyof typeof PERF)}
              >
                <option value="month">This Month</option>
                <option value="last">Last Month</option>
                <option value="qtr">Last Quarter</option>
              </Select>
            </div>

            <div className="mt-3 flex items-center gap-6">
              <div>
                <p className="flex items-center gap-1.5 text-[10.5px] font-medium text-ink-3">
                  <span className="h-2 w-2 rounded-full bg-accent" aria-hidden /> Impressions
                </p>
                <p className="mt-1 text-[18px] font-semibold tabular-nums text-ink">{perf.totalImpr}</p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-[10.5px] font-medium text-ink-3">
                  <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" aria-hidden /> Clicks
                </p>
                <p className="mt-1 text-[18px] font-semibold tabular-nums text-ink">{perf.totalClicks}</p>
              </div>
            </div>

            <PerformanceChart series={perf} />

            <Btn variant="outline" className="mt-3 w-full" onClick={() => onNavigate("analytics")}>
              View Analytics
              <BarChart3 className="h-3.5 w-3.5" aria-hidden />
            </Btn>
          </Card>

          <div className="mt-5 hidden items-center gap-2 text-[10.5px] text-ink-3 lg:flex">
            <CircleCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
            All systems operational — demo data refreshed locally.
          </div>
        </div>
      </div>
    </div>
  );
}
