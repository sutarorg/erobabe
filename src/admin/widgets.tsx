import { useMemo } from "react";
import { cn } from "../utils/cn";

/* --------------------------- Status badge --------------------------- */

const badgeStyles: Record<string, string> = {
  published: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  resolved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  healthy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  processing: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  "in-review": "border-amber-500/30 bg-amber-500/10 text-amber-400",
  draft: "border-line bg-white/[0.04] text-ink-2",
  unpublished: "border-line bg-transparent text-ink-3",
  new: "border-accent/40 bg-accent/12 text-accent",
  rejected: "border-red-500/30 bg-red-500/10 text-red-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-400",
  suspended: "border-red-500/30 bg-red-500/10 text-red-400",
  disabled: "border-line bg-transparent text-ink-3",
  paused: "border-line bg-white/[0.03] text-ink-2",
  completed: "border-line bg-white/[0.03] text-ink-3",
  info: "border-line bg-white/[0.03] text-ink-2",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  error: "border-red-500/30 bg-red-500/10 text-red-400",
  available: "border-line bg-transparent text-ink-3",
};

const dotStyles: Record<string, string> = {
  published: "bg-emerald-400", active: "bg-emerald-400", paid: "bg-emerald-400",
  resolved: "bg-emerald-400", healthy: "bg-emerald-400", processing: "bg-amber-400",
  pending: "bg-amber-400", "in-review": "bg-amber-400", draft: "bg-zinc-400",
  unpublished: "bg-zinc-600", new: "bg-accent", rejected: "bg-red-400",
  failed: "bg-red-400", suspended: "bg-red-400", disabled: "bg-zinc-600",
  paused: "bg-zinc-400", completed: "bg-zinc-500", info: "bg-zinc-400",
  warning: "bg-amber-400", error: "bg-red-400", available: "bg-zinc-600",
};

export function AdminBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10px] font-semibold",
        badgeStyles[status] ?? badgeStyles.info
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotStyles[status] ?? dotStyles.info)} />
      {label ?? status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ")}
    </span>
  );
}

/* ---------------------------- Sparkline ----------------------------- */

export function Sparkline({ points, color = "#F51655" }: { points: number[]; color?: string }) {
  const path = useMemo(() => {
    const max = Math.max(...points);
    const min = Math.min(...points);
    const w = 64;
    const h = 20;
    return points
      .map((v, i) => {
        const x = (w * i) / (points.length - 1);
        const y = h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points]);
  return (
    <svg viewBox="0 0 64 20" className="h-5 w-16" aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------- Revenue chart --------------------------- */

const W = 560;
const H = 176;
const PAD = { l: 44, r: 10, t: 12, b: 24 };
const PINK = "#F51655";
const GRID = "#1E1E24";
const AXIS = "#71717A";

export function RevenueChart({ data, labels }: { data: number[]; labels: string[] }) {
  const { path, fill, gridY, yLabels } = useMemo(() => {
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const n = data.length;
    const max = Math.max(...data);
    const pts = data.map((v, i): [number, number] => [
      PAD.l + (innerW * i) / (n - 1),
      PAD.t + innerH - (v / max) * innerH,
    ]);
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${(PAD.t + innerH).toFixed(1)} L ${pts[0][0].toFixed(1)} ${(PAD.t + innerH).toFixed(1)} Z`;
    return {
      pts,
      path: line,
      fill: area,
      gridY: [0.25, 0.5, 0.75, 1].map((f) => PAD.t + innerH * f),
      yLabels: [max, max / 2, 0],
    };
  }, [data]);

  const innerH = H - PAD.t - PAD.b;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Daily revenue area chart">
      <defs>
        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={PINK} stopOpacity="0.22" />
          <stop offset="100%" stopColor={PINK} stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridY.map((y) => (
        <line key={y} x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke={GRID} strokeWidth="1" />
      ))}
      {yLabels.map((v, i) => (
        <text
          key={i}
          x={PAD.l - 7}
          y={PAD.t + innerH - (innerH * i) / 2 + 3}
          textAnchor="end"
          fontSize="9"
          fill={AXIS}
        >
          ${v >= 1000 ? `${(v / 1000).toFixed(1)}K` : Math.round(v)}
        </text>
      ))}
      {labels.map((label, i) =>
        label ? (
          <text key={i} x={(W - PAD.l - PAD.r) * (i / (labels.length - 1)) + PAD.l} y={H - 7} textAnchor="middle" fontSize="9" fill={AXIS}>
            {label}
          </text>
        ) : null
      )}
      <path d={fill} fill="url(#revFill)" />
      <path d={path} fill="none" stroke={PINK} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((_, i) => {
        const x = PAD.l + ((W - PAD.l - PAD.r) * i) / (data.length - 1);
        const max = Math.max(...data);
        const y = PAD.t + innerH - (data[i] / max) * innerH;
        return <circle key={i} cx={x} cy={y} r="2" fill="#0D0E10" stroke={PINK} strokeWidth="1.5" />;
      })}
    </svg>
  );
}

/* ------------------------------ Switch ------------------------------ */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200",
        checked ? "border-accent/60 bg-accent" : "border-line bg-void"
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-transform duration-200",
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );
}

/* ------------------------- table classnames -------------------------- */

export const TH_CLASS = "px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3";
export const TR_HOVER = "transition-colors hover:bg-white/[0.02]";
