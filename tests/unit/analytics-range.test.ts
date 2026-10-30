import { describe, expect, it } from "vitest";
import {
  MAX_RANGE_DAYS,
  bucketLabel,
  bucketFor,
  isoDay,
  parseAnalyticsRange,
  parseIsoDay,
  rangeDays,
  rangeExportParams,
  rangeLabel,
  rangeQuery,
} from "@/lib/analytics/range";

const NOW = new Date("2026-10-30T09:15:00.000Z");

describe("analytics date ranges", () => {
  it("turns a preset into a half-open UTC window", () => {
    const range = parseAnalyticsRange({ range: "7d" }, NOW);
    expect(range.fromIso).toBe("2026-10-24T00:00:00.000Z");
    expect(range.toIso).toBe(NOW.toISOString());
    expect(range.days).toBe(7);
    expect(range.bucket).toBe("day");
    expect(range.previousFromIso).toBe("2026-10-17T00:00:00.000Z");
    expect(range.previousToIso).toBe("2026-10-24T00:00:00.000Z");
  });

  it("starts 'today' at UTC midnight and uses hourly buckets", () => {
    const range = parseAnalyticsRange({ range: "today" }, NOW);
    expect(range.fromIso).toBe("2026-10-30T00:00:00.000Z");
    expect(range.days).toBe(1);
    expect(range.bucket).toBe("hour");
  });

  it("defaults to seven days for an unknown preset", () => {
    const range = parseAnalyticsRange({ range: "since-the-dawn-of-time" }, NOW);
    expect(range.preset).toBe("7d");
    expect(range.days).toBe(7);
  });

  it("compares against the whole preceding window", () => {
    const range = parseAnalyticsRange({ range: "28d" }, NOW);
    expect(range.previousToIso).toBe(range.fromIso);
    expect(range.previousFromIso).toBe("2026-09-05T00:00:00.000Z");
    // "Today" compares with the same hours of the previous day.
    const today = parseAnalyticsRange({ range: "today" }, NOW);
    expect(today.previousFromIso).toBe("2026-10-29T00:00:00.000Z");
    expect(today.previousToIso).toBe("2026-10-30T00:00:00.000Z");
  });

  it("parses a custom range with an inclusive end day", () => {
    const range = parseAnalyticsRange(
      { range: "custom", from: "2026-10-01", to: "2026-10-07" },
      NOW,
    );
    expect(range.preset).toBe("custom");
    expect(range.fromIso).toBe("2026-10-01T00:00:00.000Z");
    expect(range.toIso).toBe("2026-10-08T00:00:00.000Z");
    expect(range.days).toBe(7);
    expect(range.invalid).toBe(false);
  });

  it("falls back to 7d when custom dates are missing, unparsable or inverted", () => {
    for (const input of [
      { range: "custom", from: "2026-10-07", to: "2026-10-01" },
      { range: "custom", from: "", to: "" },
      { range: "custom", from: "2026-02-31", to: "2026-03-02" },
    ]) {
      const range = parseAnalyticsRange(input, NOW);
      expect(range.preset).toBe("7d");
      expect(range.invalid).toBe(true);
    }
  });

  it("clamps a custom range to the 90-day maximum instead of querying a year", () => {
    const range = parseAnalyticsRange(
      { range: "custom", from: "2025-01-01", to: "2026-10-01" },
      NOW,
    );
    expect(range.clamped).toBe(true);
    expect(range.days).toBeLessThanOrEqual(MAX_RANGE_DAYS + 1);
    expect(range.toIso).toBe("2026-10-02T00:00:00.000Z");
    expect(range.from.getTime()).toBeLessThan(range.to.getTime());
  });

  it("treats a future custom end as now and keeps a positive interval", () => {
    const range = parseAnalyticsRange(
      { range: "custom", from: "2026-10-29", to: "2030-01-01" },
      NOW,
    );
    expect(range.to.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(range.from.getTime()).toBeLessThan(range.to.getTime());
  });

  it("accepts array params (Next passes repeated query keys as arrays)", () => {
    const range = parseAnalyticsRange({ range: ["28d", "7d"] }, NOW);
    expect(range.preset).toBe("28d");
  });

  it("validates calendar days strictly", () => {
    expect(parseIsoDay("2026-10-30")?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(parseIsoDay("2026-02-31")).toBeNull();
    expect(parseIsoDay("30-10-2026")).toBeNull();
    expect(parseIsoDay("")).toBeNull();
  });

  it("labels the window by the last day it covers", () => {
    const range = parseAnalyticsRange(
      { range: "custom", from: "2026-10-01", to: "2026-10-03" },
      NOW,
    );
    expect(rangeLabel(range.preset, range.from, range.to)).toContain("Oct 3");
    expect(bucketLabel(range.fromIso, "day")).toBe("Oct 1");
    expect(bucketLabel("2026-10-30T05:00:00.000Z", "hour")).toBe("Oct 30, 05:00");
  });

  it("serialises the selection back into a query string", () => {
    const range = parseAnalyticsRange(
      { range: "custom", from: "2026-10-01", to: "2026-10-03" },
      NOW,
    );
    expect(rangeQuery(range)).toBe("range=custom&from=2026-10-01&to=2026-10-03");
    expect(rangeQuery(range, { path: "/latest" })).toContain("path=%2Flatest");
    expect(rangeExportParams(range)).toEqual({ from: "2026-10-01", to: "2026-10-03" });
    expect(isoDay(range.from)).toBe("2026-10-01");
  });

  it("computes buckets and day counts defensively", () => {
    expect(bucketFor(new Date(0), new Date(3_600_000))).toBe("hour");
    expect(bucketFor(new Date(0), new Date(5 * 86_400_000))).toBe("day");
    expect(rangeDays(new Date(0), new Date(0))).toBe(1);
    expect(rangeDays(new Date(0), new Date(-5))).toBe(1);
  });
});
