import { useMemo } from "react";
import type { PerfSeries } from "./data";

const W = 560;
const H = 176;
const PAD = { l: 36, r: 10, t: 12, b: 24 };

const PINK = "#F51655";
const PURPLE = "#8B5CF6";
const GRID = "#1E1E24";
const AXIS = "#71717A";

function toPath(points: [number, number][]) {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
}

/**
 * Two-series line chart rendered as local inline SVG.
 * Impressions (pink) and clicks (purple) each normalized to their own max.
 */
export default function PerformanceChart({ series }: { series: PerfSeries }) {
  const { imprPts, clickPts, impPath, fillPath, gridY, yLabels } = useMemo(() => {
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const n = series.impr.length;
    const maxI = Math.max(...series.impr);
    const maxC = Math.max(...series.clicks);
    const xAt = (i: number) => PAD.l + (innerW * i) / (n - 1);
    const imp: [number, number][] = series.impr.map((v, i) => [
      xAt(i),
      PAD.t + innerH - (v / maxI) * innerH,
    ]);
    const clk: [number, number][] = series.clicks.map((v, i) => [
      xAt(i),
      PAD.t + innerH - (v / maxC) * innerH,
    ]);
    const line = toPath(imp);
    const fill = `${line} L ${imp[n - 1][0].toFixed(1)} ${(PAD.t + innerH).toFixed(1)} L ${imp[0][0].toFixed(1)} ${(PAD.t + innerH).toFixed(1)} Z`;
    return {
      imprPts: imp,
      clickPts: clk,
      impPath: line,
      fillPath: fill,
      gridY: [0.25, 0.5, 0.75, 1].map((f) => PAD.t + innerH * f),
      yLabels: [maxI, maxI / 2, 0].map((v) => Math.round(v)),
    };
  }, [series]);

  const innerH = H - PAD.t - PAD.b;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 w-full"
      role="img"
      aria-label="Campaign performance line chart showing impressions and clicks"
    >
      <defs>
        <linearGradient id="impFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={PINK} stopOpacity="0.16" />
          <stop offset="100%" stopColor={PINK} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* gridlines */}
      {gridY.map((y) => (
        <line key={y} x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke={GRID} strokeWidth="1" />
      ))}

      {/* y-axis labels */}
      {yLabels.map((v, i) => (
        <text
          key={i}
          x={PAD.l - 7}
          y={PAD.t + innerH - (innerH * i) / 2 + 3}
          textAnchor="end"
          fontSize="9"
          fill={AXIS}
        >
          {v}K
        </text>
      ))}

      {/* x-axis labels */}
      {series.labels.map((label, i) =>
        label ? (
          <text
            key={i}
            x={imprPts[i][0]}
            y={H - 7}
            textAnchor="middle"
            fontSize="9"
            fill={AXIS}
          >
            {label}
          </text>
        ) : null
      )}

      {/* impressions area + line */}
      <path d={fillPath} fill="url(#impFill)" />
      <path
        d={impPath}
        fill="none"
        stroke={PINK}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={toPath(clickPts)}
        fill="none"
        stroke={PURPLE}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* markers */}
      {imprPts.map(([x, y], i) => (
        <circle key={`i${i}`} cx={x} cy={y} r="2" fill="#0D0E10" stroke={PINK} strokeWidth="1.5" />
      ))}
      {clickPts.map(([x, y], i) => (
        <circle key={`c${i}`} cx={x} cy={y} r="2" fill="#0D0E10" stroke={PURPLE} strokeWidth="1.5" />
      ))}
    </svg>
  );
}
