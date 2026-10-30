/**
 * Date-range handling for the admin analytics surface.
 *
 * Every range is expressed in UTC and as a half-open interval `[from, to)`,
 * which is what every SQL aggregate in migration 28 expects. Custom ranges are
 * clamped so a hand-edited URL can never ask the database for a year of raw
 * rows: the longest report is 90 days, the same window the raw tables keep.
 */

export const MAX_RANGE_DAYS = 90;
export const MIN_RANGE_MS = 60_000;

export type RangePreset = "today" | "7d" | "28d" | "90d" | "custom";

export type AnalyticsRange = {
  preset: RangePreset;
  /** Inclusive start, UTC. */
  from: Date;
  /** Exclusive end, UTC. */
  to: Date;
  fromIso: string;
  toIso: string;
  /** Calendar days covered by the range, rounded up (1 for "today"). */
  days: number;
  /** Chart bucket that keeps a series readable at this length. */
  bucket: "hour" | "day";
  label: string;
  /** Same-length window immediately before `from`, for period comparisons. */
  previousFrom: Date;
  previousTo: Date;
  previousFromIso: string;
  previousToIso: string;
  /** True when a custom range was shortened to the 90-day maximum. */
  clamped: boolean;
  /** True when the requested custom dates were unusable and 7d was used. */
  invalid: boolean;
};

export const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "28d", label: "Last 28 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom" },
];

const DAY_MS = 86_400_000;

export type RangeInput = {
  range?: string | string[] | null;
  from?: string | string[] | null;
  to?: string | string[] | null;
};

function first(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return (value ?? "").trim();
}

/** UTC midnight for a `YYYY-MM-DD` string, or null when it is not a date. */
export function parseIsoDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  // Reject 2026-02-31, which Date.parse would roll into March.
  if (date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

/** `YYYY-MM-DD` for a date, in UTC. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole calendar days between two instants, rounded up, minimum 1. */
export function rangeDays(from: Date, to: Date): number {
  const span = to.getTime() - from.getTime();
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.max(1, Math.ceil(span / DAY_MS));
}

export function bucketFor(from: Date, to: Date): "hour" | "day" {
  return to.getTime() - from.getTime() <= 2 * DAY_MS ? "hour" : "day";
}

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const monthDayYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const hourStamp = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** A short, unambiguous label for the selected window. */
export function rangeLabel(preset: RangePreset, from: Date, to: Date): string {
  if (preset === "today") return `Today · ${monthDayYear.format(from)} (UTC)`;
  // `to` is exclusive: show the last day that is actually covered.
  const lastDay = new Date(to.getTime() - MIN_RANGE_MS);
  const sameYear = from.getUTCFullYear() === lastDay.getUTCFullYear();
  const start = sameYear ? monthDay.format(from) : monthDayYear.format(from);
  return `${start} – ${monthDayYear.format(lastDay)} (UTC)`;
}

function baseRange(preset: RangePreset, from: Date, to: Date, clamped = false, invalid = false): AnalyticsRange {
  // The comparison window ends where the selected one starts. Day-based ranges
  // compare against the same number of whole days; "today" compares like with
  // like, at the same point of the previous day.
  const previousTo = new Date(from.getTime());
  const previousFrom = new Date(
    from.getTime() - (preset === "today" ? DAY_MS : rangeDays(from, to) * DAY_MS),
  );
  return {
    preset,
    from,
    to,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    days: rangeDays(from, to),
    bucket: bucketFor(from, to),
    label: rangeLabel(preset, from, to),
    previousFrom,
    previousTo,
    previousFromIso: previousFrom.toISOString(),
    previousToIso: previousTo.toISOString(),
    clamped,
    invalid,
  };
}

/**
 * Parses `?range=&from=&to=` into a safe window.
 *
 * Unusable input never throws: an unknown preset becomes 7d, inverted or
 * unparsable custom dates become 7d, and a custom range longer than 90 days is
 * shortened from the start (the end the operator chose is preserved).
 */
export function parseAnalyticsRange(input: RangeInput = {}, now: Date = new Date()): AnalyticsRange {
  const requested = first(input.range);
  const preset = (RANGE_PRESETS.find((entry) => entry.value === requested)?.value ?? "7d") as RangePreset;
  const todayStart = startOfUtcDay(now);
  const end = new Date(Math.max(now.getTime(), todayStart.getTime() + MIN_RANGE_MS));

  if (preset === "custom") {
    const fromDay = parseIsoDay(first(input.from));
    const toDay = parseIsoDay(first(input.to));
    if (!fromDay || !toDay || fromDay.getTime() >= toDay.getTime()) {
      return baseRange("7d", addDays(todayStart, -6), end, false, true);
    }
    // `to` is an inclusive calendar day in the URL; the interval is half-open.
    const exclusiveTo = addDays(toDay, 1);
    const latest = new Date(Math.max(end.getTime(), fromDay.getTime() + MIN_RANGE_MS));
    const clampedTo = exclusiveTo.getTime() > latest.getTime() ? latest : exclusiveTo;
    if (clampedTo.getTime() - fromDay.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      const clampedFrom = new Date(clampedTo.getTime() - MAX_RANGE_DAYS * DAY_MS);
      return baseRange("custom", clampedFrom, clampedTo, true);
    }
    return baseRange("custom", fromDay, clampedTo);
  }

  const days = preset === "today" ? 1 : preset === "7d" ? 7 : preset === "28d" ? 28 : 90;
  const from = preset === "today" ? todayStart : addDays(todayStart, -(days - 1));
  return baseRange(preset, from, end);
}

/** Query string for links that keep the current window. */
export function rangeQuery(range: AnalyticsRange, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  params.set("range", range.preset);
  if (range.preset === "custom") {
    params.set("from", isoDay(range.from));
    // `to` is displayed inclusively.
    params.set("to", isoDay(new Date(range.to.getTime() - MIN_RANGE_MS)));
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

/** The `from`/`to` a CSV export needs for a range. */
export function rangeExportParams(range: AnalyticsRange): { from: string; to: string } {
  return { from: isoDay(range.from), to: isoDay(new Date(range.to.getTime() - MIN_RANGE_MS)) };
}

/** Chart x-axis label for one bucket start. */
export function bucketLabel(iso: string, bucket: "hour" | "day"): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return bucket === "hour" ? hourStamp.format(date) : monthDay.format(date);
}
