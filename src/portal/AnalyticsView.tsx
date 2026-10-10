import { TrendingUp } from "lucide-react";
import { useState } from "react";
import { cn } from "../utils/cn";
import { PERF, TOP_SLOTS, TRAFFIC_SOURCES } from "./data";
import PerformanceChart from "./PerformanceChart";
import { Card, PageHeader, Select } from "./ui";

type PerfKey = keyof typeof PERF;

const PERIOD_LABELS: Record<PerfKey, string> = {
  month: "This Month",
  last: "Last Month",
  qtr: "Last Quarter",
};

function MiniStat({ label, value, growth }: { label: string; value: string; growth: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-ink-3">{label}</p>
        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-400">
          <TrendingUp className="h-2.5 w-2.5" aria-hidden />
          {growth}
        </span>
      </div>
      <p className="mt-1.5 text-[20px] font-semibold tabular-nums tracking-tight text-ink">{value}</p>
    </Card>
  );
}

function BarRow({
  name,
  value,
  pct,
  color,
}: {
  name: string;
  value: string;
  pct: number;
  color: string;
}) {
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="truncate pr-3 text-ink-2">{name}</span>
        <span className="shrink-0 font-semibold tabular-nums text-ink">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-void">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AnalyticsView() {
  const [perfKey, setPerfKey] = useState<PerfKey>("month");
  const perf = PERF[perfKey];

  return (
    <div>
      <PageHeader
        title="Analytics"
        sub="Account-wide performance across all placements."
        actions={
          <Select label="Analytics period" value={perfKey} onChange={(e) => setPerfKey(e.target.value as PerfKey)}>
            {(Object.keys(PERIOD_LABELS) as PerfKey[]).map((k) => (
              <option key={k} value={k}>
                {PERIOD_LABELS[k]}
              </option>
            ))}
          </Select>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Impressions" value={perf.totalImpr} growth="+18.2%" />
        <MiniStat label="Clicks" value={perf.totalClicks} growth="+9.6%" />
        <MiniStat label="CTR" value="1.55%" growth="+6.9%" />
        <MiniStat label="Active placements" value="3" growth="+1" />
      </div>

      <Card className="mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold tracking-tight text-ink">
            Delivery — {PERIOD_LABELS[perfKey]}
          </h2>
          <div className="flex items-center gap-4 text-[10.5px] font-medium text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden /> Impressions
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" aria-hidden /> Clicks
            </span>
          </div>
        </div>
        <PerformanceChart series={perf} />
      </Card>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[14px] font-semibold tracking-tight text-ink">Top performing placements</h2>
          <div className="mt-2 divide-y divide-line/60">
            {TOP_SLOTS.map((s) => (
              <BarRow key={s.name} name={s.name} value={s.value} pct={s.pct} color="bg-accent" />
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-[14px] font-semibold tracking-tight text-ink">Traffic sources</h2>
          <div className="mt-2 divide-y divide-line/60">
            {TRAFFIC_SOURCES.map((s) => (
              <BarRow key={s.name} name={s.name} value={`${s.pct}%`} pct={s.pct} color="bg-[#8B5CF6]" />
            ))}
          </div>
          <p className="mt-4 text-[10.5px] leading-relaxed text-ink-3">
            Sources are estimated from click referrer data across the trailing 30 days. Demo data.
          </p>
        </Card>
      </div>
    </div>
  );
}
