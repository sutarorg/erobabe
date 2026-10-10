import { CircleCheck, CircleX, Layers, Link2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, Card, PageHeader, Select } from "../portal/ui";
import { cn } from "../utils/cn";
import { fmtUSD, SLOT_PRICE, type AdCreative, type AdminSlot } from "./data";
import { AdminBadge, TH_CLASS } from "./widgets";

/* -------------------------- Advertisements -------------------------- */

export function AdvertisementsView({
  ads,
  onAddClick,
  onSetStatus,
}: {
  ads: AdCreative[];
  onAddClick: () => void;
  onSetStatus: (id: string, status: AdCreative["status"]) => void;
}) {
  const [filter, setFilter] = useState("all");
  const filtered = useMemo(() => ads.filter((a) => filter === "all" || a.status === filter), [ads, filter]);

  return (
    <div>
      <PageHeader
        title="Advertisements"
        sub="Creatives go live immediately — advertisers publish without approval."
        actions={
          <>
            <Select label="Filter advertisements" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="rejected">Rejected</option>
            </Select>
            <Btn size="sm" onClick={onAddClick}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add Advertisement
            </Btn>
          </>
        }
      />

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["Creative", "Advertiser", "Destination", "Placement", "Period", "Status", "Actions"].map((h) => (
                  <th key={h} className={cn(TH_CLASS, h === "Actions" && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filtered.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <img src={a.thumb} alt="" className="h-9 w-16 shrink-0 rounded-md border border-line object-cover" draggable={false} />
                      <span className="max-w-[190px] truncate text-[12.5px] font-medium text-ink">{a.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-2">{a.advertiser}</td>
                  <td className="max-w-[170px] px-4 py-3">
                    <span className="flex items-center gap-1 truncate text-[11px] text-ink-3">
                      <Link2 className="h-3 w-3 shrink-0" aria-hidden />{a.url}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-2">Slot {a.slotId} · {a.slotName}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11px] text-ink-3">{a.period}</td>
                  <td className="px-4 py-3"><AdminBadge status={a.status} /></td>
                  <td className="px-4 py-3">
                    {/* No approval step — admins can still take a live creative
                        down, or restore one that was taken down. */}
                    <div className="flex items-center justify-end gap-1.5">
                      {a.status === "active" ? (
                        <button type="button" aria-label={`Take down ${a.name}`} onClick={() => onSetStatus(a.id, "rejected")} className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] font-medium text-ink-3 transition-colors hover:border-red-500/50 hover:text-red-400">
                          <CircleX className="h-3 w-3" aria-hidden /> Take down
                        </button>
                      ) : (
                        <button type="button" aria-label={`Restore ${a.name}`} onClick={() => onSetStatus(a.id, "active")} className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] font-medium text-ink-3 transition-colors hover:border-emerald-500/50 hover:text-emerald-400">
                          <CircleCheck className="h-3 w-3" aria-hidden /> Restore
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="py-10 text-center text-[12.5px] text-ink-3">No creatives match this filter.</p>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------- Ad Slots ----------------------------- */

export function AdSlotsView({
  slots,
  onOpenSlot,
  onCreateClick,
}: {
  slots: AdminSlot[];
  onOpenSlot: (slot: AdminSlot) => void;
  onCreateClick: () => void;
}) {
  const active = slots.filter((s) => s.status === "active").length;
  return (
    <div>
      <PageHeader
        title="Ad Slots"
        sub={`${slots.length} placements · ${active} occupied · flat ${fmtUSD(SLOT_PRICE)}/month, fixed 16:9 ratio.`}
        actions={
          <Btn size="sm" onClick={onCreateClick}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Create Ad Slot
          </Btn>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {slots.map((slot) => (
          <Card key={slot.id} className="group p-3.5">
            {/* 16:9 placement preview — ratio must remain exact */}
            <div className="relative flex aspect-video flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-accent/35 bg-pcard-2">
              {slot.custom && (
                <span className="absolute right-2 top-2 rounded bg-accent/12 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-accent">
                  Custom
                </span>
              )}
              <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-300">Ad Slot {slot.id}</span>
              <span className="text-[10px] font-medium tracking-[0.16em] text-accent">16:9</span>
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/8 text-[10px] font-semibold text-accent">
                {slot.id}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-ink">{slot.name}</span>
                <span className="block truncate text-[10.5px] text-ink-3">
                  {slot.status === "active"
                    ? `${slot.advertiser ?? "—"}${slot.start ? ` · ${slot.start}–${slot.end}` : ""}`
                    : "Vacant"}
                </span>
              </span>
              <AdminBadge status={slot.status} />
            </div>
            <Btn variant="outline" size="sm" className="mt-3 w-full" onClick={() => onOpenSlot(slot)}>
              <Layers className="h-3.5 w-3.5" aria-hidden /> Manage slot
            </Btn>
          </Card>
        ))}
      </div>
    </div>
  );
}
