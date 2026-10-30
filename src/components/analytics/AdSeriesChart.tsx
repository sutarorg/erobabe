"use client";

import { useId, useState } from "react";
import { formatCount } from "@/lib/analytics/metrics";
import { bucketLabel } from "@/lib/analytics/range";
import { clamp, niceTicks, tickIndices, useMeasuredWidth } from "./chart-geometry";

export type AdSeriesPoint = { bucket: string; impressions: number; clicks: number };

const HEIGHT = 208;
const PAD = { top: 16, right: 44, bottom: 26, left: 46 };
const TOOLTIP_WIDTH = 152;

/**
 * Daily ad delivery: impressions as columns, clicks as a line.
 *
 * The two series share the plot but not the scale — a 0.2% CTR would be a flat
 * line at the bottom of an impressions axis, so clicks get their own right-hand
 * labels and the legend says which colour belongs to which axis.
 *
 * Like the traffic chart it measures its container and draws in CSS pixels, so
 * the highlighted column, the dot on the clicks line and the tooltip all sit
 * exactly under the cursor, and the plot fills the card instead of floating in
 * letter-boxed space.
 */
export default function AdSeriesChart({
  points,
  title = "Ad delivery",
  emptyLabel = "No impressions or clicks recorded in this range",
}: {
  points: AdSeriesPoint[];
  title?: string;
  emptyLabel?: string;
}) {
  // `useId` contains colons, which make an SVG `url(#…)` reference brittle.
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [active, setActive] = useState<number | null>(null);
  const [pointerY, setPointerY] = useState<number | null>(null);
  const [frame, width] = useMeasuredWidth<HTMLDivElement>(720);

  const innerWidth = Math.max(24, width - PAD.left - PAD.right);
  const innerHeight = Math.max(24, HEIGHT - PAD.top - PAD.bottom);
  const baseline = PAD.top + innerHeight;

  const totalImpressions = points.reduce((sum, point) => sum + point.impressions, 0);
  const totalClicks = points.reduce((sum, point) => sum + point.clicks, 0);
  const maxImpressions = Math.max(1, ...points.map((point) => point.impressions));
  const maxClicks = Math.max(1, ...points.map((point) => point.clicks));

  const impressionTicks = niceTicks(maxImpressions, 4);
  const impressionTop = impressionTicks[impressionTicks.length - 1] || 1;
  // Clicks keep their own rounded top so the line uses the full height.
  const clickTicks = niceTicks(maxClicks, 2);
  const clickTop = clickTicks[clickTicks.length - 1] || 1;

  const slot = points.length > 0 ? innerWidth / points.length : innerWidth;
  const barWidth = clamp(slot * 0.55, 3, 30);
  const center = (index: number) => PAD.left + index * slot + slot / 2;
  const yImpressions = (value: number) =>
    baseline - (clamp(value, 0, impressionTop) / impressionTop) * innerHeight;
  const yClicks = (value: number) => baseline - (clamp(value, 0, clickTop) / clickTop) * innerHeight;

  const activePoint = active !== null ? points[active] : null;
  const labels = tickIndices(points.length, innerWidth);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-line px-3 text-center text-[12px] text-ink-3"
        style={{ height: HEIGHT }}
      >
        {emptyLabel}
      </div>
    );
  }

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${center(index).toFixed(1)},${yClicks(point.clicks).toFixed(1)}`)
    .join(" ");

  const scrub = (clientX: number, clientY: number, rect: DOMRect) => {
    if (!rect.width || !rect.height) return;
    const px = ((clientX - rect.left) / rect.width) * width;
    const py = ((clientY - rect.top) / rect.height) * HEIGHT;
    // Columns are centred in their slot, so locate by slot rather than by edge.
    setActive(clamp(Math.floor((px - PAD.left) / (slot || 1)), 0, points.length - 1));
    setPointerY(clamp(py, PAD.top, baseline));
  };

  const anchorX = active !== null ? center(active) : 0;
  const flip = anchorX + 16 + TOOLTIP_WIDTH > width;
  const tooltipLeft = clamp(
    flip ? anchorX - TOOLTIP_WIDTH - 14 : anchorX + 14,
    4,
    Math.max(4, width - TOOLTIP_WIDTH - 4),
  );
  const tooltipTop = clamp((pointerY ?? PAD.top + innerHeight / 2) - 12, 4, Math.max(4, HEIGHT - 84));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm bg-accent/80" />
            Impressions <span className="text-ink-3/70">(left)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3 rounded-full bg-sky-300" />
            Clicks <span className="text-ink-3/70">(right)</span>
          </span>
        </div>
      </div>

      <div ref={frame} className="relative">
        <svg
          role="img"
          tabIndex={0}
          aria-label={`${title}: ${points.length} days, ${formatCount(totalImpressions)} impressions and ${formatCount(
            totalClicks,
          )} clicks in total. Use the arrow keys to step through days, or the table below for exact values.`}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          className="w-full touch-pan-y cursor-crosshair rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          style={{ height: HEIGHT }}
          onPointerMove={(event) => scrub(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())}
          onPointerDown={(event) => scrub(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())}
          onPointerLeave={(event) => {
            // A tap is a deliberate read: keep it on screen until the next
            // touch. Only a mouse leaving the plot clears the readout.
            if (event.pointerType !== "touch") setActive(null);
          }}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (step) {
              event.preventDefault();
              setPointerY(null);
              setActive((current) => clamp((current ?? (step === 1 ? -1 : points.length)) + step, 0, points.length - 1));
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              setPointerY(null);
              setActive(event.key === "Home" ? 0 : points.length - 1);
            } else if (event.key === "Escape") {
              setActive(null);
            }
          }}
        >
          <defs>
            <linearGradient id={`${gradientId}-bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.95" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerWidth}
            height={innerHeight}
            fill="var(--color-void)"
            fillOpacity="0.35"
            rx="3"
          />

          {/* Impressions axis (left) and its grid. */}
          {impressionTicks.map((value) => (
            <g key={`i-${value}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + innerWidth}
                y1={yImpressions(value)}
                y2={yImpressions(value)}
                stroke="var(--color-line)"
                strokeOpacity={value === 0 ? 1 : 0.55}
                strokeDasharray={value === 0 ? undefined : "3 5"}
              />
              <text
                x={PAD.left - 9}
                y={yImpressions(value) + 3}
                textAnchor="end"
                fontSize="9"
                fill="var(--color-ink-3)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatCount(value)}
              </text>
            </g>
          ))}

          {/* Clicks axis (right): only the top and the middle, to stay quiet. */}
          {clickTicks.map((value) => (
            <text
              key={`c-${value}`}
              x={PAD.left + innerWidth + 9}
              y={yClicks(value) + 3}
              textAnchor="start"
              fontSize="9"
              fill="#7dd3fc"
              fillOpacity="0.85"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatCount(value)}
            </text>
          ))}

          {active !== null && (
            <rect
              x={PAD.left + active * slot}
              y={PAD.top}
              width={slot}
              height={innerHeight}
              fill="var(--color-accent)"
              fillOpacity="0.07"
              rx="3"
            />
          )}

          {points.map((point, index) => {
            const top = yImpressions(point.impressions);
            return (
              <rect
                key={point.bucket}
                x={center(index) - barWidth / 2}
                y={top}
                width={barWidth}
                height={Math.max(0, baseline - top)}
                rx={Math.min(3, barWidth / 2)}
                fill={`url(#${gradientId}-bar)`}
                fillOpacity={active === null || active === index ? 1 : 0.4}
              />
            );
          })}

          <path d={line} fill="none" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {points.map((point, index) =>
            active === index ? (
              <g key={`dot-${point.bucket}`}>
                <circle cx={center(index)} cy={yClicks(point.clicks)} r="4.5" fill="#7dd3fc" fillOpacity="0.22" />
                <circle
                  cx={center(index)}
                  cy={yClicks(point.clicks)}
                  r="2.6"
                  fill="#7dd3fc"
                  stroke="var(--color-void)"
                  strokeWidth="1.5"
                />
              </g>
            ) : null,
          )}

          {labels.map((index) => (
            <text
              key={index}
              x={center(index)}
              y={HEIGHT - 8}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
              fontSize="9"
              fill={active === index ? "var(--color-ink)" : "var(--color-ink-3)"}
              fontWeight={active === index ? 600 : 400}
            >
              {bucketLabel(points[index].bucket, "day")}
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
              <p className="mb-1 font-medium text-ink">{bucketLabel(activePoint.bucket, "day")}</p>
              <p className="mt-0.5 flex items-center justify-between gap-3 text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-sm bg-accent" />
                  Impressions
                </span>
                <span className="tabular-nums text-ink">{formatCount(activePoint.impressions)}</span>
              </p>
              <p className="mt-0.5 flex items-center justify-between gap-3 text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
                  Clicks
                </span>
                <span className="tabular-nums text-ink">{formatCount(activePoint.clicks)}</span>
              </p>
            </>
          )}
        </div>
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Impressions</th>
            <th scope="col">Clicks</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucket}>
              <th scope="row">{bucketLabel(point.bucket, "day")}</th>
              <td>{formatCount(point.impressions)}</td>
              <td>{formatCount(point.clicks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
