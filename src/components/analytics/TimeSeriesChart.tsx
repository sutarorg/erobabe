"use client";

import { useId, useState } from "react";
import { bucketLabel } from "@/lib/analytics/range";
import { formatCount } from "@/lib/analytics/metrics";
import type { SeriesPoint } from "@/lib/analytics/queries";
import { cn } from "@/src/utils/cn";
import {
  clamp,
  nearestIndex,
  niceTicks,
  tickIndices,
  useMeasuredWidth,
} from "./chart-geometry";

type SeriesKey = "pageviews" | "sessions" | "visitors";

const SERIES: Array<{ key: SeriesKey; label: string; color: string }> = [
  { key: "pageviews", label: "Pageviews", color: "var(--color-accent)" },
  { key: "sessions", label: "Sessions", color: "#7dd3fc" },
  { key: "visitors", label: "Visitors", color: "#86efac" },
];

const HEIGHT = 232;
const PAD = { top: 16, right: 16, bottom: 26, left: 46 };
const TOOLTIP_WIDTH = 156;

/**
 * The traffic chart.
 *
 * Hand-drawn SVG — no charting dependency, so it costs no extra JavaScript
 * beyond this component. It measures its own container and draws in that pixel
 * space, which keeps the crosshair, the highlighted dot and the tooltip exactly
 * under the cursor at any panel width.
 *
 * Interaction: pointer hover or touch scrubs the series, arrow keys / Home /
 * End step through buckets when the chart has focus, and the legend toggles a
 * series. The same numbers are always available in the visually hidden table
 * underneath for screen readers and for when a hover is not possible.
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
  // `useId` contains colons, which make an SVG `url(#…)` reference brittle.
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [visible, setVisible] = useState<SeriesKey[]>(initialSeries);
  const [active, setActive] = useState<number | null>(null);
  const [pointerY, setPointerY] = useState<number | null>(null);
  const [frame, width] = useMeasuredWidth<HTMLDivElement>(720);

  const innerWidth = Math.max(24, width - PAD.left - PAD.right);
  const innerHeight = Math.max(24, height - PAD.top - PAD.bottom);
  const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const baseline = PAD.top + innerHeight;

  const values = points.flatMap((point) => visible.map((key) => Number(point[key]) || 0));
  const ticks = niceTicks(Math.max(1, ...values), 4);
  const top = ticks[ticks.length - 1] || 1;

  const x = (index: number) => PAD.left + (points.length > 1 ? index * stepX : innerWidth / 2);
  const y = (value: number) => baseline - (clamp(value, 0, top) / top) * innerHeight;

  const shown = SERIES.filter((series) => visible.includes(series.key));
  const paths = shown.map((series) => {
    const line = points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(Number(point[series.key]) || 0).toFixed(1)}`,
      )
      .join(" ");
    const area =
      points.length > 0
        ? `${line} L${x(points.length - 1).toFixed(1)},${baseline.toFixed(1)} L${x(0).toFixed(1)},${baseline.toFixed(1)} Z`
        : "";
    return { ...series, line, area };
  });

  const activePoint = active !== null ? points[active] : null;
  const labels = tickIndices(points.length, innerWidth);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-line text-[12px] text-ink-3"
        style={{ height }}
      >
        No traffic recorded in this range
      </div>
    );
  }

  const scrub = (clientX: number, clientY: number, rect: DOMRect) => {
    if (!rect.width || !rect.height) return;
    // Everything is expressed in user units, which equal CSS pixels because the
    // viewBox is built from the measured width.
    const px = ((clientX - rect.left) / rect.width) * width;
    const py = ((clientY - rect.top) / rect.height) * height;
    setActive(nearestIndex(px, PAD.left, stepX, points.length));
    setPointerY(clamp(py, PAD.top, baseline));
  };

  const move = (direction: 1 | -1) => {
    setPointerY(null);
    setActive((current) => clamp((current ?? (direction === 1 ? -1 : points.length)) + direction, 0, points.length - 1));
  };

  const anchorX = active !== null ? x(active) : 0;
  const flip = anchorX + 16 + TOOLTIP_WIDTH > width;
  const tooltipLeft = clamp(
    flip ? anchorX - TOOLTIP_WIDTH - 14 : anchorX + 14,
    4,
    Math.max(4, width - TOOLTIP_WIDTH - 4),
  );
  const tooltipTop = clamp(
    (pointerY ?? PAD.top + innerHeight / 2) - 12,
    4,
    Math.max(4, height - 84),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
                  on
                    ? "border-line bg-white/[0.06] text-ink"
                    : "border-transparent text-ink-3 hover:text-ink-2",
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

      <div ref={frame} className="relative">
        <svg
          role="img"
          tabIndex={0}
          aria-label={`${title}: ${points.length} ${bucket === "hour" ? "hours" : "days"} of ${shown
            .map((series) => series.label.toLowerCase())
            .join(", ")}. Use the arrow keys to step through buckets, or the table below for exact values.`}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="w-full touch-pan-y cursor-crosshair rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          style={{ height }}
          onPointerMove={(event) => scrub(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())}
          onPointerDown={(event) => scrub(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())}
          onPointerLeave={(event) => {
            // A tap is a deliberate read: keep it on screen until the next
            // touch. Only a mouse leaving the plot clears the readout.
            if (event.pointerType !== "touch") setActive(null);
          }}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              setActive(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActive(points.length - 1);
            } else if (event.key === "Escape") {
              setActive(null);
            }
          }}
        >
          <defs>
            {shown.map((series) => (
              <linearGradient key={series.key} id={`${gradientId}-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series.color} stopOpacity={shown.length > 1 ? 0.2 : 0.28} />
                <stop offset="100%" stopColor={series.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Plot backdrop: separates the data area from the card without a border. */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerWidth}
            height={innerHeight}
            fill="var(--color-void)"
            fillOpacity="0.35"
            rx="3"
          />

          {ticks.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={PAD.left + innerWidth}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--color-line)"
                strokeOpacity={value === 0 ? 1 : 0.55}
                strokeDasharray={value === 0 ? undefined : "3 5"}
              />
              <text
                x={PAD.left - 9}
                y={y(value) + 3}
                textAnchor="end"
                fontSize="9"
                fill="var(--color-ink-3)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatCount(value)}
              </text>
            </g>
          ))}

          {paths.map((path, index) => (
            <g key={path.key}>
              {/*
                Only the first visible series is filled. Filling both painted one
                gradient over the other, which read as a stacked total — a number
                this chart never claimed to show.
              */}
              {index === 0 && <path d={path.area} fill={`url(#${gradientId}-${path.key})`} stroke="none" />}
              <path
                d={path.line}
                fill="none"
                stroke={path.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}

          {active !== null && activePoint && (
            <g>
              {/* Highlight band: the whole bucket, not just the line. */}
              <rect
                x={Math.max(PAD.left, x(active) - Math.max(6, stepX / 2))}
                y={PAD.top}
                width={Math.min(innerWidth, Math.max(12, stepX))}
                height={innerHeight}
                fill="var(--color-accent)"
                fillOpacity="0.07"
                rx="3"
              />
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={baseline}
                stroke="var(--color-accent)"
                strokeOpacity="0.55"
                strokeWidth="1"
              />
              {shown.map((series) => (
                <g key={series.key}>
                  <circle cx={x(active)} cy={y(Number(activePoint[series.key]) || 0)} r="4.5" fill={series.color} fillOpacity="0.22" />
                  <circle
                    cx={x(active)}
                    cy={y(Number(activePoint[series.key]) || 0)}
                    r="2.6"
                    fill={series.color}
                    stroke="var(--color-void)"
                    strokeWidth="1.5"
                  />
                </g>
              ))}
            </g>
          )}

          {labels.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={height - 8}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
              fontSize="9"
              fill={active === index ? "var(--color-ink)" : "var(--color-ink-3)"}
              fontWeight={active === index ? 600 : 400}
            >
              {bucketLabel(points[index].bucket, bucket)}
            </text>
          ))}
        </svg>

        <div
          data-chart-tooltip=""
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-void/95 p-2 text-[10.5px] shadow-xl backdrop-blur-sm transition-opacity duration-100"
          style={{ left: tooltipLeft, top: tooltipTop, width: TOOLTIP_WIDTH, opacity: activePoint ? 1 : 0 }}
          aria-hidden
        >
          {activePoint && (
            <>
              <p className="mb-1 font-medium text-ink">{bucketLabel(activePoint.bucket, bucket)}</p>
              {shown.map((series) => (
                <p key={series.key} className="mt-0.5 flex items-center justify-between gap-3 text-ink-2">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: series.color }} />
                    {series.label}
                  </span>
                  <span className="tabular-nums text-ink">{formatCount(Number(activePoint[series.key]) || 0)}</span>
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
