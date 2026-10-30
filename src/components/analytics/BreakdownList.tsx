import Link from "next/link";
import { formatCount, formatPercent } from "@/lib/analytics/metrics";
import type { DimensionRow } from "@/lib/analytics/queries";

/**
 * A ranked breakdown (top pages, referrers, devices, countries…).
 *
 * The bar is the share of the range's sessions, so the list reads as a
 * distribution. Rows can link to a drill-down page; the list itself is a server
 * component, so the links carry no client JavaScript.
 */
export default function BreakdownList({
  rows,
  metric = "sessions",
  emptyLabel = "Nothing recorded in this range",
  hrefFor,
  limit = 10,
  showShare = true,
}: {
  rows: DimensionRow[];
  metric?: "sessions" | "pageviews" | "visitors";
  emptyLabel?: string;
  hrefFor?: (row: DimensionRow) => string;
  limit?: number;
  showShare?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line bg-void/40 px-3 py-6 text-center text-[12px] text-ink-3">
        {emptyLabel}
      </p>
    );
  }

  const max = Math.max(1, ...rows.slice(0, limit).map((row) => Number(row[metric]) || 0));

  return (
    <ul className="space-y-1.5">
      {rows.slice(0, limit).map((row) => {
        const value = Number(row[metric]) || 0;
        const width = Math.max(2, Math.round((value / max) * 100));
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] text-ink" title={row.key}>
                {row.label}
              </span>
              <span className="shrink-0 text-[11.5px] tabular-nums text-ink-2">
                {formatCount(value)}
                {showShare && <span className="ml-1.5 text-ink-3">{formatPercent(row.share, 1)}</span>}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5" aria-hidden>
              <div className="h-full rounded-full bg-accent/70" style={{ width: `${width}%` }} />
            </div>
          </>
        );
        return (
          <li key={row.key || "(not set)"}>
            {hrefFor ? (
              <Link href={hrefFor(row)} className="block rounded px-1 py-0.5 hover:bg-white/[0.04]">
                {inner}
              </Link>
            ) : (
              <div className="px-1 py-0.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
