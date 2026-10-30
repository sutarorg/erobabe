"use client";

import { useMemo, useState } from "react";
import { bucketLabel } from "@/lib/analytics/range";
import { formatCount } from "@/lib/analytics/metrics";
import type { SeriesPoint } from "@/lib/analytics/queries";
import { cn } from "@/src/utils/cn";

type SeriesKey = "pageviews" | "sessions" | "visitors";

const SERIES: Array<{ key: SeriesKey; label: string; color: string }> = [
  { key: "pageviews", label: "Pageviews", color: "var(--color-accent)" },
  { key: "sessions", label: "Sessions", color: "#7dd3fc" },
  { key: "visitors", label: "Visitors", color: "#86efac" },
];

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 16, right: 12, bottom: 26, left: 44 };

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = magnitude / 2;
  return Math.ceil(value / step) * step;
}

/**
 * The traffic chart.
 *
 * Hand-drawn SVG (no charting dependency, so it costs no extra JavaScript
 * beyond this component) with a hover/focus readout, a legend that toggles
 * series, and a visually hidden table that carries exactly the same numbers for
 * screen readers.
 */
export default function TimeSeriesChart({
  points,
  bucket,
  height = HEIGHT,
  title = "Traffic over time",
  initialSeries = ["pageviews", "sessions"],
}: {
  points: SeriesPoint[];
  bucket: "hour" | "day";
  height?: number;
  title?: string;
  initialSeries?: SeriesKey[];
}) {
  const [visible, setVisible] = useState<SeriesKey[]>(initialSeries);
  const [active, setActive] = useState<number | null>(null);

  const max = useMemo(() => {
    const values = points.flatMap((point) => visible.map((key) => Number(point[key]) || 0));
    return niceMax(Math.max(1, ...values));
  }, [points, visible]);

  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;
  const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  const x = (index: number) => PAD.left + (points.length > 1 ? index * stepX : innerWidth / 2);
  const y = (value: number) => PAD.top + innerHeight - (Math.min(value, max) / max) * innerHeight;

  const paths = useMemo(
    () =>
      SERIES.filter((series) => visible.includes(series.key)).map((series) => {
        const line = points
          .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(Number(point[series.key]) || 0).toFixed(1)}`)
          .join(" ");
        const area =
          points.length > 0
            ? `${line} L${x(points.length - 1).toFixed(1)},${(PAD.top + innerHeight).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + innerHeight).toFixed(1)} Z`
            : "";
        return { ...series, line, area };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, visible, max, height],
  );

  const activePoint = active !== null ? points[active] : null;
  const gridValues = [0, 0.5, 1].map((fraction) => Math.round(max * fraction));

  if (points.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-md border border-dashed border-line text-[12px] text-ink-3">
        No traffic recorded in this range
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chart series">
          {SERIES.map((series) => {
            const on = visible.includes(series.key);
            return (
              <button
                key={series.key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setVisible((current) =>
                    current.includes(series.key)
                      ? current.length === 1
                        ? current
                        : current.filter((key) => key !== series.key)
                      : [...current, series.key],
                  )
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-medium transition-colors",
                  on ? "border-line bg-white/5 text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
                )}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: on ? series.color : "var(--color-ink-3)" }}
                />
                {series.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <svg
          role="img"
          aria-label={`${title}: ${points.length} ${bucket === "hour" ? "hours" : "days"} of pageviews, sessions and visitors. Use the table below for exact values.`}
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="w-full"
          style={{ height }}
          onMouseLeave={() => setActive(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / rect.width;
            const index = Math.round((ratio * WIDTH - PAD.left) / (stepX || 1));
            setActive(Math.max(0, Math.min(points.length - 1, index)));
          }}
        >
          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--color-line)"
                strokeDasharray="3 4"
              />
              <text x={PAD.left - 8} y={y(value) + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-3)">
                {formatCount(value)}
              </text>
            </g>
          ))}

          {paths.map((path) => (
            <g key={path.key}>
              {visible.length === 1 && (
                <path d={path.area} fill={path.color} fillOpacity="0.12" stroke="none" />
              )}
              <path d={path.line} fill="none" stroke={path.color} strokeWidth="1.8" strokeLinejoin="round" />
            </g>
          ))}

          {active !== null && activePoint && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + innerHeight}
                stroke="var(--color-ink-3)"
                strokeDasharray="3 3"
              />
              {visible.map((key) => (
                <circle
                  key={key}
                  cx={x(active)}
                  cy={y(Number(activePoint[key]) || 0)}
                  r="3"
                  fill={SERIES.find((series) => series.key === key)?.color}
                  stroke="var(--color-void)"
                  strokeWidth="1.5"
                />
              ))}
            </g>
          )}

          {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index, position) => (
            <text
              key={`${index}-${position}`}
              x={x(index)}
              y={height - 6}
              textAnchor={position === 0 ? "start" : position === 2 ? "end" : "middle"}
              fontSize="9"
              fill="var(--color-ink-3)"
            >
              {bucketLabel(points[index].bucket, bucket)}
            </text>
          ))}
        </svg>

        <div
          className="pointer-events-none absolute left-0 top-0 min-h-[52px] min-w-[132px] rounded-md border border-line bg-void/95 p-2 text-[10.5px] shadow-lg"
          style={{ transform: "translate(12px, 4px)", opacity: activePoint ? 1 : 0 }}
          aria-hidden
        >
          {activePoint && (
            <>
              <p className="font-medium text-ink">{bucketLabel(activePoint.bucket, bucket)}</p>
              {visible.map((key) => (
                <p key={key} className="mt-0.5 flex items-center justify-between gap-3 text-ink-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: SERIES.find((series) => series.key === key)?.color }}
                    />
                    {SERIES.find((series) => series.key === key)?.label}
                  </span>
                  <span className="tabular-nums text-ink">{formatCount(Number(activePoint[key]) || 0)}</span>
                </p>
              ))}
            </>
          )}
        </div>
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{bucket === "hour" ? "Hour" : "Day"}</th>
            {SERIES.map((series) => (
              <th key={series.key} scope="col">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucket}>
              <th scope="row">{bucketLabel(point.bucket, bucket)}</th>
              {SERIES.map((series) => (
                <td key={series.key}>{formatCount(Number(point[series.key]) || 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
