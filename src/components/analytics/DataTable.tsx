"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download } from "lucide-react";
import {
  formatMetric,
  paginate,
  sortRows,
  type MetricKind,
  type SortDirection,
} from "@/lib/analytics/metrics";
import { cn } from "@/src/utils/cn";

export type TableColumn = {
  key: string;
  label: string;
  kind?: MetricKind;
  align?: "left" | "right";
  sortable?: boolean;
  /** Turns this cell into a link using another field of the row. */
  linkKey?: string;
  /** Hidden below the small breakpoint to keep the table readable on a phone. */
  secondary?: boolean;
};

export type TableRow = Record<string, string | number | null | undefined> & { id: string };

/**
 * Sortable, paginated table used by every analytics report.
 *
 * The server sends an already bounded result set (top 100 pages, the ten
 * placements, every order in the window), so sorting and paging happen in the
 * browser without another request. Numbers sort numerically, text
 * alphabetically, and the header buttons expose `aria-sort`.
 */
export default function DataTable({
  columns,
  rows,
  caption,
  emptyLabel = "Nothing recorded in this range",
  initialSort,
  defaultPageSize = 10,
  csvHref,
}: {
  columns: TableColumn[];
  rows: TableRow[];
  caption: string;
  emptyLabel?: string;
  initialSort?: { key: string; direction: SortDirection };
  defaultPageSize?: number;
  csvHref?: string;
}) {
  const firstSortable = columns.find((column) => column.sortable !== false);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>(
    initialSort ?? { key: firstSortable?.key ?? "id", direction: "desc" },
  );
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => sortRows(rows, sort.key, sort.direction), [rows, sort]);
  const view = useMemo(() => paginate(sorted, page, pageSize), [sorted, page, pageSize]);

  const toggle = (key: string) => {
    setPage(1);
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" },
    );
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line bg-void/40 px-3 py-6 text-center text-[12px] text-ink-3">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div>
      <div className="center-scroll overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-void/60 text-[10.5px] uppercase tracking-wider text-ink-3">
            <tr>
              {columns.map((column) => {
                const active = sort.key === column.key;
                const align = column.align ?? (column.kind && column.kind !== "text" ? "right" : "left");
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      column.sortable === false ? undefined : active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                    className={cn(
                      "whitespace-nowrap px-3 py-2 font-medium",
                      align === "right" ? "text-right" : "text-left",
                      column.secondary && "hidden sm:table-cell",
                    )}
                  >
                    {column.sortable === false ? (
                      column.label
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(column.key)}
                        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink-2"
                      >
                        {column.label}
                        {active ? (
                          sort.direction === "asc" ? (
                            <ChevronUp aria-hidden className="h-3 w-3 text-accent" />
                          ) : (
                            <ChevronDown aria-hidden className="h-3 w-3 text-accent" />
                          )
                        ) : (
                          <ChevronDown aria-hidden className="h-3 w-3 opacity-30" />
                        )}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.id} className="border-b border-line/50 last:border-0 hover:bg-white/[0.03]">
                {columns.map((column) => {
                  const align = column.align ?? (column.kind && column.kind !== "text" ? "right" : "left");
                  const value = formatMetric(row[column.key], column.kind ?? "text");
                  const href = column.linkKey ? String(row[column.linkKey] ?? "") : "";
                  return (
                    <td
                      key={column.key}
                      className={cn(
                        "truncate px-3 py-2",
                        align === "right" ? "text-right tabular-nums" : "text-left",
                        column.secondary && "hidden sm:table-cell",
                      )}
                      title={value}
                    >
                      {href ? (
                        href.startsWith("/") ? (
                          <Link href={href} className="text-accent hover:underline">
                            {value}
                          </Link>
                        ) : (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-accent hover:underline"
                          >
                            {value}
                          </a>
                        )
                      ) : (
                        value
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
        <span>
          {view.start}–{view.end} of {view.total}
        </span>
        <div className="flex items-center gap-2">
          {csvHref && (
            <a
              href={csvHref}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-medium text-ink-2 transition hover:border-accent/40 hover:text-ink"
            >
              <Download aria-hidden className="h-3 w-3" />
              CSV
            </a>
          )}
          <label className="flex items-center gap-1">
            <span className="sr-only">Rows per page</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-md border border-line bg-void px-1.5 py-1 text-[11px] text-ink-2"
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={view.page <= 1}
              aria-label="Previous page"
              className="rounded-md border border-line p-1 disabled:opacity-40"
            >
              <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums">
              {view.page} / {view.pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(view.pageCount, current + 1))}
              disabled={view.page >= view.pageCount}
              aria-label="Next page"
              className="rounded-md border border-line p-1 disabled:opacity-40"
            >
              <ChevronRight aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
