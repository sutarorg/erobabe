import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtUSD, SLOT_PRICE, type Slot } from "./data";
import { Card, PageHeader, Select, StatusPill } from "./ui";

interface SlotsViewProps {
  slots: Slot[];
  onOpenSlot: (slot: Slot) => void;
}

export default function SlotsView({ slots, onOpenSlot }: SlotsViewProps) {
  const [posFilter, setPosFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(
    () =>
      slots.filter(
        (s) =>
          (posFilter === "all" || s.side === posFilter) &&
          (statusFilter === "all" || s.status === statusFilter)
      ),
    [slots, posFilter, statusFilter]
  );

  const availableCount = slots.filter((s) => s.status === "available").length;

  return (
    <div>
      <PageHeader
        title="Ad Slots"
        sub={`Ten fixed 16:9 placements across both rails · ${availableCount} currently available.`}
        actions={
          <>
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
          </>
        }
      />

      {filtered.length > 0 ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((slot) => (
            <button
              key={slot.id}
              type="button"
              onClick={() => onOpenSlot(slot)}
              className="group text-left"
            >
              <Card className="p-3.5 transition-colors group-hover:border-accent/45">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/8 text-[11px] font-semibold text-accent">
                    {slot.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{slot.name}</span>
                    <span className="text-[10.5px] text-ink-3">
                      {slot.side === "left" ? "Left rail" : "Right rail"} · Slot {slot.id}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[13.5px] font-semibold tabular-nums text-ink">
                      {fmtUSD(SLOT_PRICE)}
                    </span>
                    <span className="text-[10px] text-ink-3">/month</span>
                  </span>
                </div>

                <p className="mt-2.5 text-[11px] text-ink-3">
                  16:9 ratio · est. {slot.estImpr}/day · avg CTR {slot.ctr}
                </p>

                <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-3">
                  <StatusPill status={slot.status} />
                  {slot.status === "active" ? (
                    <span className="truncate text-[11px] text-ink-3">
                      {slot.campaignName ?? slot.advertiser}
                      {slot.start ? ` · ${slot.start}–${slot.end}` : ""}
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5 text-[11px] font-semibold text-accent">
                      Reserve
                      <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  )}
                </div>
              </Card>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-line py-12 text-center text-[12.5px] text-ink-3">
          No placements match these filters.
        </p>
      )}
    </div>
  );
}
