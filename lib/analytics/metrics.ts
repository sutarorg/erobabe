/**
 * Metric definitions, formatting and table helpers shared by the admin
 * analytics pages, their CSV exports and their tests.
 *
 * Nothing here talks to the database or to React, so the same numbers are used
 * for the cards, the tables, the charts and the exported files.
 *
 * Definitions (mirrored in `docs/ANALYTICS.md`):
 *
 *  - CTR        clicks / impressions
 *  - booked CPM advertiser cost per thousand impressions, from the contracted
 *               order value that overlaps the range
 *  - eCPM       publisher revenue per thousand impressions, from verified
 *               PayPal orders only
 *  - fill rate  share of placement-days inside the range that a live
 *               advertisement occupied
 *  - revenue    verified order value prorated to the days of the range
 */

export type MetricKind = "number" | "compact" | "currency" | "percent" | "duration" | "datetime" | "text";

export const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

export function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

export function ctr(clicks: number, impressions: number): number {
  return safeRatio(clicks, impressions);
}

/** Cost per thousand impressions, in cents. */
export function cpmCents(valueCents: number, impressions: number): number {
  if (!Number.isFinite(valueCents) || valueCents <= 0) return 0;
  return safeRatio(valueCents, impressions) * 1000;
}

/** Revenue per thousand impressions, in cents. */
export function ecpmCents(revenueCents: number, impressions: number): number {
  return cpmCents(revenueCents, impressions);
}

/**
 * Relative change against the previous period, or null when the previous
 * period has no value (a percentage change from zero is not a number).
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

/** Milliseconds of real overlap between two half-open intervals. */
export function overlapMs(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Value of an order attributed to the selected range.
 *
 * A 30-day placement that overlaps seven days of the report contributes a
 * quarter of its price; a placement that covers the whole window contributes
 * all of it. Orders without a schedule contribute nothing, because there is no
 * honest way to attribute them.
 */
export function proratedAmountCents(
  amountCents: number,
  startsAt: string | null,
  endsAt: string | null,
  from: Date,
  to: Date,
): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  if (!startsAt || !endsAt) return 0;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const overlap = overlapMs(start, end, from.getTime(), to.getTime());
  if (overlap <= 0) return 0;
  return Math.round((amountCents * overlap) / (end - start));
}

/**
 * Fill rate: the share of placement-days in the range that a live
 * advertisement occupied.
 *
 * Overlapping orders for the same placement are merged before measuring, so a
 * double-booked day can never inflate the figure past 100%.
 */
export function fillRate(
  slotCount: number,
  orders: Array<{ slot_id: number; starts_at: string | null; ends_at: string | null }>,
  from: Date,
  to: Date,
): number {
  const windowStart = from.getTime();
  const windowEnd = to.getTime();
  const totalMs = Math.max(0, windowEnd - windowStart) * Math.max(0, slotCount);
  if (totalMs <= 0) return 0;

  const bySlot = new Map<number, Array<[number, number]>>();
  for (const order of orders) {
    if (!order.starts_at || !order.ends_at) continue;
    const start = Math.max(Date.parse(order.starts_at), windowStart);
    const end = Math.min(Date.parse(order.ends_at), windowEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const list = bySlot.get(order.slot_id) ?? [];
    list.push([start, end]);
    bySlot.set(order.slot_id, list);
  }

  let occupied = 0;
  for (const intervals of bySlot.values()) {
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    let [cursorStart, cursorEnd] = sorted[0];
    for (const [start, end] of sorted.slice(1)) {
      if (start <= cursorEnd) {
        cursorEnd = Math.max(cursorEnd, end);
      } else {
        occupied += cursorEnd - cursorStart;
        cursorStart = start;
        cursorEnd = end;
      }
    }
    occupied += cursorEnd - cursorStart;
  }

  return Math.min(1, occupied / totalMs);
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return numberFormat.format(Number(value));
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  return Math.abs(numeric) < 10_000 ? numberFormat.format(numeric) : compactFormat.format(numeric);
}

/** Cents → `$1,234.56`. */
export function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return "—";
  return `$${twoDecimals.format(Number(cents) / 100)}`;
}

/** Fraction (0.0523) → `5.23%`. */
export function formatPercent(fraction: number | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(Number(fraction))) return "—";
  return `${(Number(fraction) * 100).toFixed(digits)}%`;
}

/** Seconds → `4m 12s`, `2h 03m` or `38s`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "—";
  const total = Math.max(0, Math.round(Number(seconds)));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return dateTimeFormat.format(date);
}

export function formatDecimal(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  if (digits === 1) return oneDecimal.format(Number(value));
  return Number(value).toFixed(digits);
}

/** Formats one value for a card, a table cell or a CSV cell. */
export function formatMetric(value: number | string | null | undefined, kind: MetricKind = "number"): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (kind) {
    case "compact":
      return formatCompact(Number(value));
    case "currency":
      return formatCurrency(Number(value));
    case "percent":
      return formatPercent(Number(value));
    case "duration":
      return formatDuration(Number(value));
    case "datetime":
      return formatDateTime(String(value));
    case "text":
      return String(value);
    case "number":
    default:
      return formatCount(Number(value));
  }
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export type SortDirection = "asc" | "desc";

function comparable(value: unknown): string | number {
  if (value === null || value === undefined) return Number.NEGATIVE_INFINITY;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value).toLowerCase();
}

/** Stable sort by one column; unknown keys leave the order untouched. */
export function sortRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  key: string,
  direction: SortDirection = "desc",
): T[] {
  const copy = [...rows];
  if (!rows.length || !(key in rows[0])) return copy;
  const factor = direction === "asc" ? 1 : -1;
  return copy.sort((a, b) => {
    const left = comparable(a[key]);
    const right = comparable(b[key]);
    if (left === right) return 0;
    if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
    return String(left).localeCompare(String(right)) * factor;
  });
}

export type Page<T> = {
  rows: T[];
  /** 1-based current page, clamped into range. */
  page: number;
  pageCount: number;
  total: number;
  /** 1-based index of the first row on this page (0 when empty). */
  start: number;
  end: number;
};

/** Client-side pagination over an already bounded result set. */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize) || 10);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const offset = (current - 1) * size;
  const slice = rows.slice(offset, offset + size);
  return {
    rows: slice,
    page: current,
    pageCount,
    total,
    start: total === 0 ? 0 : offset + 1,
    end: offset + slice.length,
  };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export type CsvColumn = { key: string; label: string };

/**
 * Escapes one CSV cell.
 *
 * Formula injection is neutralised the way spreadsheet vendors recommend: a
 * value that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is
 * prefixed with an apostrophe so Excel and Sheets treat it as text. Without
 * that, an advertisement named `=HYPERLINK(...)` would execute in the
 * operator's spreadsheet.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(columns: readonly CsvColumn[], rows: ReadonlyArray<Record<string, unknown>>): string {
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(","));
  // CRLF keeps Excel on Windows happy; the BOM is added by the route.
  return [header, ...body].join("\r\n");
}
