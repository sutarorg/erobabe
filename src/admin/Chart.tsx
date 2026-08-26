import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp, Minus, BarChart3 } from "lucide-react";
import { cn, formatViews } from "@/lib/format";

export interface SeriesPoint {
  day: string;
  views: number;
}

/* ── helpers ── */

const niceCeil = (v: number) => {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return step * mag;
};

const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Catmull-Rom → cubic bezier, clamped so the curve never dips past the plot. */
function smoothPath(pts: { x: number; y: number }[], minY: number, maxY: number) {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const clamp = (v: number) => Math.min(maxY, Math.max(minY, v));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function useWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(260, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ── trend pill ── */

function TrendPill({ current, previous }: { current: number; previous: number }) {
  if (previous <= 0 && current <= 0) return null;
  const delta = previous === 0 ? 100 : ((current - previous) / previous) * 100;
  const flat = Math.abs(delta) < 1;
  const up = delta > 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      title="Compared with the previous equivalent period"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
        flat
          ? "bg-white/5 text-fog-400 ring-white/10"
          : up
            ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"
            : "bg-red-500/10 text-red-300 ring-red-500/25"
      )}
    >
      <Icon className="size-3" aria-hidden />
      {flat ? "Flat" : `${up ? "+" : ""}${Math.round(delta)}%`}
    </span>
  );
}

/* ── main chart ── */

export function ViewsChart({
  data,
  height = 240,
  title = "Views",
  subtitle,
  actions,
  className,
}: {
  data: SeriesPoint[];
  height?: number;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const padL = 46;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const innerW = Math.max(10, width - padL - padR);
  const innerH = Math.max(10, height - padT - padB);

  const stats = useMemo(() => {
    const total = data.reduce((n, d) => n + d.views, 0);
    const peak = data.reduce((m, d) => Math.max(m, d.views), 0);
    const avg = data.length ? total / data.length : 0;
    const half = Math.floor(data.length / 2);
    const prev = data.slice(0, half).reduce((n, d) => n + d.views, 0);
    const curr = data.slice(half).reduce((n, d) => n + d.views, 0);
    return { total, peak, avg, prev, curr };
  }, [data]);

  const maxY = niceCeil(Math.max(stats.peak, 1));
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const pts = data.map((d, i) => ({
    x: padL + (data.length > 1 ? i * stepX : innerW / 2),
    y: padT + innerH * (1 - d.views / maxY),
    ...d,
  }));

  const line = smoothPath(pts, padT, padT + innerH);
  const area =
    pts.length > 0
      ? `${line} L ${pts[pts.length - 1].x} ${padT + innerH} L ${pts[0].x} ${padT + innerH} Z`
      : "";

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => maxY * f);
  const labelEvery = Math.max(1, Math.ceil(data.length / (width < 480 ? 4 : 7)));
  const active = hover != null ? pts[hover] : null;
  const empty = stats.total === 0;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!data.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padL;
    const idx = stepX > 0 ? Math.round(x / stepX) : 0;
    setHover(Math.min(data.length - 1, Math.max(0, idx)));
  };

  return (
    <section className={cn("rounded-2xl border border-white/6 bg-ink-900/60 p-5", className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            <TrendPill current={stats.curr} previous={stats.prev} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl font-bold tracking-tight text-white tabular-nums">
              {formatViews(stats.total)}
            </span>
            <span className="text-xs text-fog-600">
              {subtitle ?? `${data.length} days`} · avg {formatViews(Math.round(stats.avg))}/day · peak{" "}
              {formatViews(stats.peak)}
            </span>
          </div>
        </div>
        {actions}
      </header>

      <div ref={ref} className="relative w-full" style={{ height }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title} chart — ${stats.total} total views over ${data.length} days`}
          className="touch-pan-y overflow-visible"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="eb-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f7f" stopOpacity="0.42" />
              <stop offset="55%" stopColor="#a855f7" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="eb-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fb6fa8" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>

          {/* grid + y labels */}
          {gridValues.map((v, i) => {
            const y = padT + innerH * (1 - v / maxY);
            return (
              <g key={i}>
                <line
                  x1={padL}
                  x2={padL + innerW}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.07)"
                  strokeDasharray={i === 0 ? "0" : "3 4"}
                />
                <text x={padL - 10} y={y + 3.5} textAnchor="end" className="fill-fog-600" style={{ fontSize: 10 }}>
                  {formatViews(Math.round(v))}
                </text>
              </g>
            );
          })}

          {!empty && (
            <>
              <path d={area} fill="url(#eb-area)" />
              <path
                d={line}
                fill="none"
                stroke="url(#eb-line)"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {/* x labels */}
          {pts.map((p, i) =>
            i % labelEvery === 0 || i === pts.length - 1 ? (
              <text
                key={p.day}
                x={p.x}
                y={height - 8}
                textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}
                className="fill-fog-600"
                style={{ fontSize: 10 }}
              >
                {shortDay(p.day)}
              </text>
            ) : null
          )}

          {/* hover crosshair */}
          {active && !empty && (
            <g pointerEvents="none">
              <line
                x1={active.x}
                x2={active.x}
                y1={padT}
                y2={padT + innerH}
                stroke="rgba(255,255,255,0.22)"
                strokeDasharray="3 3"
              />
              <circle cx={active.x} cy={active.y} r={9} fill="rgba(244,63,127,0.18)" />
              <circle cx={active.x} cy={active.y} r={4.5} fill="#fff" stroke="#f43f7f" strokeWidth={2.5} />
            </g>
          )}
        </svg>

        {/* tooltip */}
        {active && !empty && (
          <div
            className="glass pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border border-white/10 px-3 py-2 shadow-2xl"
            style={{
              left: Math.min(Math.max(active.x, 62), width - 62),
              top: Math.max(active.y - 12, 26),
            }}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider text-fog-500">{longDay(active.day)}</p>
            <p className="mt-0.5 text-sm font-bold text-white tabular-nums">
              {active.views.toLocaleString()} <span className="text-xs font-medium text-fog-400">views</span>
            </p>
          </div>
        )}

        {empty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <BarChart3 className="mx-auto size-6 text-fog-700" aria-hidden />
              <p className="mt-2 text-xs font-medium text-fog-600">No views recorded in this period yet</p>
              <p className="text-[11px] text-fog-700">Views appear here as visitors watch published videos.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── compact bar list used beside the main chart ── */

export function TopBars({
  items,
  className,
}: {
  items: { id: string; label: string; value: number; thumb?: string | null }[];
  className?: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (!items.length) {
    return <p className={cn("py-8 text-center text-xs text-fog-600", className)}>No data yet.</p>;
  }
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map((item, i) => (
        <li key={item.id}>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="w-4 shrink-0 text-center text-[11px] font-bold text-fog-600">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-fog-200">{item.label}</span>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-fog-400">
              {formatViews(item.value)}
            </span>
          </div>
          <div className="ml-6.5 h-1.5 overflow-hidden rounded-full bg-white/6">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-all duration-500"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
