import { CirclePlus, Eye, Pause, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../utils/cn";
import type { Campaign, CampaignStatus } from "./data";
import type { PortalView } from "./Sidebar";
import { Btn, Card, PageHeader, StatusPill } from "./ui";

type Tab = "active" | "pending" | "completed" | "rejected";

const TABS: { key: Tab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "completed", label: "Completed" },
  { key: "rejected", label: "Rejected" },
];

interface CampaignsViewProps {
  campaigns: Campaign[];
  onOpenCampaign: (campaign: Campaign) => void;
  onTogglePause: (campaign: Campaign) => void;
  onNavigate: (view: PortalView) => void;
}

const matches = (c: Campaign, tab: Tab): boolean =>
  tab === "active" ? c.status === "active" || c.status === "paused" : c.status === tab;

export default function CampaignsView({
  campaigns,
  onOpenCampaign,
  onTogglePause,
  onNavigate,
}: CampaignsViewProps) {
  const [tab, setTab] = useState<Tab>("active");

  const counts = useMemo(() => {
    const map: Record<Tab, number> = { active: 0, pending: 0, completed: 0, rejected: 0 };
    campaigns.forEach((c) => {
      if (c.status === "active" || c.status === "paused") map.active += 1;
      else if (c.status in map) map[c.status as Tab] += 1;
    });
    return map;
  }, [campaigns]);

  const rows = campaigns.filter((c) => matches(c, tab));

  const pauseable = (status: CampaignStatus) => status === "active" || status === "paused";

  return (
    <div>
      <PageHeader
        title="My Campaigns"
        sub="Manage, pause and review all of your placements."
        actions={
          <Btn size="sm" onClick={() => onNavigate("create")}>
            <CirclePlus className="h-3.5 w-3.5" aria-hidden />
            New Campaign
          </Btn>
        }
      />

      <div className="mt-4 flex w-fit items-center gap-1 rounded-lg border border-line bg-pcard p-1" role="tablist" aria-label="Campaign status filter">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
              tab === t.key ? "bg-white/[0.07] text-ink" : "text-ink-3 hover:text-ink-2"
            )}
          >
            {t.label}
            <span
              className={cn(
                "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9.5px] font-semibold",
                tab === t.key ? "bg-accent/20 text-accent" : "bg-white/[0.06] text-ink-3"
              )}
            >
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["Campaign", "Placement", "Status", "Period", "Impressions", "Clicks", ""].map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={c.thumb}
                        alt=""
                        draggable={false}
                        className="h-9 w-14 shrink-0 rounded-md border border-line object-cover"
                      />
                      <span className="text-[12.5px] font-medium text-ink">{c.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-2">
                    Slot {c.slotId} · {c.placement}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11px] tabular-nums text-ink-3">
                    {c.start} → {c.end}
                  </td>
                  <td className="px-4 py-3 text-[12px] tabular-nums text-ink-2">{c.impressions}</td>
                  <td className="px-4 py-3 text-[12px] tabular-nums text-ink-2">{c.clicks}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenCampaign(c)}
                        aria-label={`View ${c.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-3 transition-colors hover:border-zinc-500 hover:text-ink"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      {pauseable(c.status) && (
                        <button
                          type="button"
                          onClick={() => onTogglePause(c)}
                          aria-label={c.status === "active" ? `Pause ${c.name}` : `Resume ${c.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-3 transition-colors hover:border-zinc-500 hover:text-ink"
                        >
                          {c.status === "active" ? (
                            <Pause className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <Play className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="py-10 text-center text-[12.5px] text-ink-3">
            No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} campaigns yet.
          </p>
        )}
      </Card>
    </div>
  );
}
