"use client";

import { useState } from "react";
import { formatCount } from "@/lib/analytics/metrics";
import { bucketLabel } from "@/lib/analytics/range";

export type AdSeriesPoint = { bucket: string; impressions: number; clicks: number };

const WIDTH = 720;
const HEIGHT = 200;
const PAD = { top: 14, right: 12, bottom: 24, left: 44 };

/**
 * Daily ad delivery: impressions as columns, clicks as a line on the same axis
 * pair. Clicks are plotted against their own maximum so a 0.2% CTR is still
 * visible; the legend says which scale belongs to which series.
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
  const [active, setActive] = useState<number | null>(null);
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;

  if (points.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-[12px] text-ink-3">
        {emptyLabel}
      </p>
    );
  }

  const maxImpressions = Math.max(1, ...points.map((point) => point.impressions));
  const maxClicks = Math.max(1, ...points.map((point) => point.clicks));
  const slot = innerWidth / points.length;
  const barWidth = Math.max(2, Math.min(26, slot * 0.55));
  const x = (index: number) => PAD.left + index * slot + slot / 2;
  const yImpressions = (value: number) => PAD.top + innerHeight - (value / maxImpressions) * innerHeight;
  const yClicks = (value: number) => PAD.top + innerHeight - (value / maxClicks) * innerHeight * 0.9;
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${yClicks(point.clicks).toFixed(1)}`)
    .join(" ");
  const activePoint = active !== null ? points[active] : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <div className="flex items-center gap-3 text-[10.5px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm bg-accent/70" /> Impressions
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3 rounded-full bg-sky-300" /> Clicks
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          role="img"
          aria-label={`${title}: ${points.length} days, ${formatCount(points.reduce((sum, point) => sum + point.impressions, 0))} impressions and ${formatCount(points.reduce((sum, point) => sum + point.clicks, 0))} clicks in total.`}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          style={{ height: HEIGHT }}
          onMouseLeave={() => setActive(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / rect.width;
            const index = Math.floor(((ratio * WIDTH - PAD.left) / innerWidth) * points.length);
            setActive(Math.max(0, Math.min(points.length - 1, index)));
          }}
        >
          {[0, 0.5, 1].map((fraction) => {
            const value = Math.round(maxImpressions * fraction);
            return (
              <g key={fraction}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={yImpressions(value)}
                  y2={yImpressions(value)}
                  stroke="var(--color-line)"
                  strokeDasharray="3 4"
                />
                <text x={PAD.left - 8} y={yImpressions(value) + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-3)">
                  {formatCount(value)}
                </text>
              </g>
            );
          })}

          {points.map((point, index) => (
            <rect
              key={point.bucket}
              x={x(index) - barWidth / 2}
              y={yImpressions(point.impressions)}
              width={barWidth}
              height={Math.max(0, PAD.top + innerHeight - yImpressions(point.impressions))}
              rx="2"
              fill="var(--color-accent)"
              fillOpacity={active === index ? 0.95 : 0.55}
            />
          ))}

          <path d={line} fill="none" stroke="#7dd3fc" strokeWidth="1.8" strokeLinejoin="round" />

          {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index, position) => (
            <text
              key={`${index}-${position}`}
              x={x(index)}
              y={HEIGHT - 6}
              textAnchor={position === 0 ? "start" : position === 2 ? "end" : "middle"}
              fontSize="9"
              fill="var(--color-ink-3)"
            >
              {bucketLabel(points[index].bucket, "day")}
            </text>
          ))}
        </svg>

        <div
          className="pointer-events-none absolute left-0 top-0 min-w-[128px] rounded-md border border-line bg-void/95 p-2 text-[10.5px] shadow-lg"
          style={{ transform: "translate(12px, 4px)", opacity: activePoint ? 1 : 0 }}
          aria-hidden
        >
          {activePoint && (
            <>
              <p className="font-medium text-ink">{bucketLabel(activePoint.bucket, "day")}</p>
              <p className="mt-0.5 flex justify-between gap-3 text-ink-2">
                <span>Impressions</span>
                <span className="tabular-nums text-ink">{formatCount(activePoint.impressions)}</span>
              </p>
              <p className="flex justify-between gap-3 text-ink-2">
                <span>Clicks</span>
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
