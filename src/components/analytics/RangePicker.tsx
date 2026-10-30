"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CalendarDays } from "lucide-react";
import { RANGE_PRESETS, isoDay, type AnalyticsRange } from "@/lib/analytics/range";
import { cn } from "@/src/utils/cn";

/**
 * Date-range control for every analytics page.
 *
 * The selection lives in the URL (`?range=`, `?from=`, `?to=`), so a report is
 * linkable, shareable and server-rendered — the page does not refetch in the
 * browser, it re-renders on the server from the new range. Presets are plain
 * links (they work without JavaScript); the custom range is one small form.
 */
export default function RangePicker({ range }: { range: AnalyticsRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [customOpen, setCustomOpen] = useState(range.preset === "custom");
  const [from, setFrom] = useState(isoDay(range.from));
  const [to, setTo] = useState(isoDay(new Date(range.to.getTime() - 60_000)));

  const withParams = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params?.toString() || "");
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!from || !to) return;
    router.push(withParams({ range: "custom", from, to }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Report date range"
        className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-pcard p-1"
      >
        {RANGE_PRESETS.filter((preset) => preset.value !== "custom").map((preset) => (
          <a
            key={preset.value}
            href={withParams({ range: preset.value, from: undefined, to: undefined })}
            aria-current={range.preset === preset.value ? "true" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              range.preset === preset.value
                ? "bg-accent/15 text-accent"
                : "text-ink-3 hover:bg-white/5 hover:text-ink-2",
            )}
          >
            {preset.label}
          </a>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen((open) => !open)}
          aria-expanded={customOpen}
          aria-controls="analytics-custom-range"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            range.preset === "custom"
              ? "bg-accent/15 text-accent"
              : "text-ink-3 hover:bg-white/5 hover:text-ink-2",
          )}
        >
          <CalendarDays aria-hidden className="h-3.5 w-3.5" />
          Custom
        </button>
      </div>

      <p className="text-[11px] text-ink-3">{range.label}</p>

      {customOpen && (
        <form
          id="analytics-custom-range"
          onSubmit={submit}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-pcard p-2"
        >
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink-3">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded-md border border-line bg-void px-2 py-1 text-[12px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink-3">
            To
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-md border border-line bg-void px-2 py-1 text-[12px] text-ink"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-accent-soft"
          >
            Apply
          </button>
        </form>
      )}

      {range.clamped && (
        <p role="note" className="text-[11px] text-amber-300">
          Ranges are capped at 90 days — showing the most recent 90.
        </p>
      )}
      {range.invalid && (
        <p role="note" className="text-[11px] text-amber-300">
          Those dates were not usable — showing the last 7 days.
        </p>
      )}
    </div>
  );
}
