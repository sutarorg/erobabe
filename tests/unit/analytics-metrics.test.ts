import { describe, expect, it } from "vitest";
import {
  computeAdvertisingPerformance,
  trafficMetrics,
  videoEngagement,
} from "@/lib/analytics/aggregate";
import {
  cpmCents,
  csvCell,
  ctr,
  ecpmCents,
  fillRate,
  formatCurrency,
  formatDuration,
  formatMetric,
  formatPercent,
  overlapMs,
  paginate,
  percentChange,
  proratedAmountCents,
  safeRatio,
  sortRows,
  toCsv,
} from "@/lib/analytics/metrics";

const FROM = new Date("2026-10-01T00:00:00.000Z");
const TO = new Date("2026-10-31T00:00:00.000Z");

describe("analytics metric arithmetic", () => {
  it("never divides by zero", () => {
    expect(safeRatio(5, 0)).toBe(0);
    expect(safeRatio(Number.NaN, 3)).toBe(0);
    expect(ctr(0, 0)).toBe(0);
    expect(ctr(5, 100)).toBeCloseTo(0.05, 6);
    expect(cpmCents(0, 0)).toBe(0);
    expect(cpmCents(1000, 10_000)).toBeCloseTo(100, 6);
    expect(ecpmCents(2500, 50_000)).toBeCloseTo(50, 6);
  });

  it("computes period-over-period change, and says null for a zero baseline", () => {
    expect(percentChange(120, 100)).toBeCloseTo(0.2, 6);
    expect(percentChange(50, 100)).toBeCloseTo(-0.5, 6);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(Number.NaN, 10)).toBeNull();
  });

  it("measures interval overlap", () => {
    expect(overlapMs(0, 10, 5, 20)).toBe(5);
    expect(overlapMs(0, 10, 10, 20)).toBe(0);
    expect(overlapMs(0, 10, -5, 20)).toBe(10);
  });

  it("prorates an order to the selected window", () => {
    // A 30-day order worth $99 that covers 10 days of the report.
    expect(
      proratedAmountCents(9900, "2026-10-01T00:00:00.000Z", "2026-10-31T00:00:00.000Z", FROM, new Date("2026-10-11T00:00:00.000Z")),
    ).toBe(3300);
    // A window that only touches the order gets one day's worth.
    expect(
      proratedAmountCents(
        3000,
        "2026-10-01T00:00:00.000Z",
        "2026-10-31T00:00:00.000Z",
        new Date("2026-10-15T00:00:00.000Z"),
        new Date("2026-10-16T00:00:00.000Z"),
      ),
    ).toBe(100);
    expect(proratedAmountCents(9900, null, null, FROM, TO)).toBe(0);
    expect(proratedAmountCents(9900, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", FROM, TO)).toBe(0);
    expect(
      proratedAmountCents(9900, "2026-09-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z", FROM, TO),
    ).toBe(0);
  });

  it("computes fill rate over placement-days, merging overlaps", () => {
    const orders = [
      { slot_id: 1, starts_at: "2026-10-01T00:00:00.000Z", ends_at: "2026-10-11T00:00:00.000Z" },
    ];
    // 10 of 30 days in one of ten slots.
    expect(fillRate(10, orders, FROM, TO)).toBeCloseTo(10 / 300, 6);
    // Same order double-booked must not exceed its own coverage.
    expect(fillRate(1, [...orders, ...orders], FROM, TO)).toBeCloseTo(10 / 30, 6);
    expect(fillRate(10, [], FROM, TO)).toBe(0);
    expect(fillRate(0, orders, FROM, TO)).toBe(0);
    // An order that ends before the window contributes nothing.
    expect(
      fillRate(10, [{ slot_id: 1, starts_at: "2026-09-01T00:00:00.000Z", ends_at: "2026-09-10T00:00:00.000Z" }], FROM, TO),
    ).toBe(0);
  });
});

describe("analytics formatting", () => {
  it("formats counts, money, percentages and durations", () => {
    expect(formatMetric(12345)).toBe("12,345");
    expect(formatMetric(12345, "compact")).toBe("12.3K");
    expect(formatCurrency(123456)).toBe("$1,234.56");
    expect(formatPercent(0.05234)).toBe("5.23%");
    expect(formatPercent(0.5, 1)).toBe("50.0%");
    expect(formatDuration(38)).toBe("38s");
    expect(formatDuration(252)).toBe("4m 12s");
    expect(formatDuration(7325)).toBe("2h 02m");
    expect(formatMetric(null)).toBe("—");
    expect(formatMetric("page", "text")).toBe("page");
    expect(formatMetric("2026-10-30T09:15:00.000Z", "datetime")).toBe("Oct 30, 09:15");
  });
});

describe("analytics tables", () => {
  const rows = [
    { id: "a", name: "Alpha", views: 10 },
    { id: "b", name: "beta", views: 300 },
    { id: "c", name: "Gamma", views: 20 },
  ];

  it("sorts numbers numerically and text case-insensitively", () => {
    expect(sortRows(rows, "views", "desc").map((row) => row.id)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, "views", "asc").map((row) => row.id)).toEqual(["a", "c", "b"]);
    expect(sortRows(rows, "name", "asc").map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "missing", "desc").map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("paginates and clamps the requested page", () => {
    const page = paginate(rows, 2, 2);
    expect(page.rows.map((row) => row.id)).toEqual(["c"]);
    expect(page.total).toBe(3);
    expect(page.pageCount).toBe(2);
    expect(page.start).toBe(3);
    expect(page.end).toBe(3);

    const clamped = paginate(rows, 99, 2);
    expect(clamped.page).toBe(2);

    const empty = paginate([], 3, 10);
    expect(empty).toEqual({ rows: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0 });
  });
});

describe("CSV export", () => {
  it("escapes quotes, commas, newlines and neutralises formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1234")).toBe("'+1234");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("writes a header row plus one row per record with CRLF", () => {
    const csv = toCsv(
      [
        { key: "page", label: "Page" },
        { key: "views", label: "Pageviews" },
      ],
      [
        { page: "/latest", views: 12 },
        { page: "/video/a,b", views: 3 },
      ],
    );
    expect(csv.split("\r\n")).toEqual([
      "Page,Pageviews",
      "/latest,12",
      '"/video/a,b",3',
    ]);
  });
});

describe("traffic and advertising aggregation", () => {
  it("derives rates from session totals", () => {
    const metrics = trafficMetrics({
      pageviews: 500,
      sessions: 100,
      visitors: 80,
      engagedSessions: 40,
      bounces: 55,
      engagedSeconds: 4500,
    });
    expect(metrics.pagesPerSession).toBe(5);
    expect(metrics.bounceRate).toBeCloseTo(0.55, 6);
    expect(metrics.engagementRate).toBeCloseTo(0.4, 6);
    expect(metrics.averageSessionSeconds).toBeCloseTo(45, 6);
    expect(metrics.averagePageSeconds).toBeCloseTo(9, 6);
    // Zero sessions never produces NaN.
    expect(trafficMetrics({ pageviews: 0, sessions: 0, visitors: 0, engagedSessions: 0, bounces: 0, engagedSeconds: 0 }).bounceRate).toBe(0);
  });

  it("computes CTR, booked CPM, eCPM, fill rate and prorated revenue per order", () => {
    const performance = computeAdvertisingPerformance({
      totals: { impressions: 20_000, clicks: 250, visitors: 5_000 },
      placements: [
        {
          slot_id: 1,
          slot_name: "Left rail top",
          side: "left",
          impressions: 12_000,
          clicks: 200,
          visitors: 3_000,
        },
        { slot_id: 2, slot_name: "Left rail 2", side: "left", impressions: 0, clicks: 0, visitors: 0 },
      ],
      orders: [
        {
          order_id: "order-1",
          ad_name: "Live ad",
          slot_id: 1,
          status: "live",
          payment_status: "verified",
          amount_cents: 9900,
          starts_at: "2026-10-01T00:00:00.000Z",
          ends_at: "2026-10-31T00:00:00.000Z",
          impressions: 12_000,
          clicks: 200,
          visitors: 3_000,
        },
        {
          order_id: "order-2",
          ad_name: "Unpaid ad",
          slot_id: 2,
          status: "in_review",
          payment_status: "unverified",
          amount_cents: 9900,
          starts_at: "2026-10-01T00:00:00.000Z",
          ends_at: "2026-10-31T00:00:00.000Z",
          impressions: 0,
          clicks: 0,
          visitors: 0,
        },
      ],
      from: FROM,
      to: TO,
      slotCount: 10,
    });

    expect(performance.ctr).toBeCloseTo(250 / 20_000, 6);
    expect(performance.bookedCents).toBe(19_800);
    // Only the verified order is revenue.
    expect(performance.revenueCents).toBe(9_900);
    expect(performance.cpmCents).toBeCloseTo((19_800 / 20_000) * 1000, 6);
    expect(performance.ecpmCents).toBeCloseTo((9_900 / 20_000) * 1000, 6);
    expect(performance.verifiedOrders).toBe(1);
    expect(performance.activeOrders).toBe(1);
    expect(performance.fillRate).toBeCloseTo((2 * 30) / (10 * 30), 6);

    const slotOne = performance.placements.find((placement) => placement.slot_id === 1)!;
    expect(slotOne.ctr).toBeCloseTo(200 / 12_000, 6);
    expect(slotOne.revenueCents).toBe(9_900);
    expect(slotOne.fillRate).toBeCloseTo(1, 6);
    expect(slotOne.activeOrders).toBe(1);

    const slotTwo = performance.placements.find((placement) => placement.slot_id === 2)!;
    expect(slotTwo.revenueCents).toBe(0);
    expect(slotTwo.fillRate).toBeCloseTo(1, 6); // booked, not paid

    // Verified order first.
    expect(performance.orders[0].order_id).toBe("order-1");
    expect(performance.orders[0].revenueCents).toBe(9_900);
    expect(performance.orders[1].revenueCents).toBe(0);
    expect(performance.orders[0].days).toBe(30);
  });

  it("does not count a deleted/rejected order as revenue", () => {
    const performance = computeAdvertisingPerformance({
      totals: { impressions: 1000, clicks: 10, visitors: 800 },
      placements: [],
      orders: [
        {
          order_id: "rejected",
          ad_name: "Rejected",
          slot_id: 3,
          status: "rejected",
          payment_status: "verified",
          amount_cents: 9900,
          starts_at: "2026-10-01T00:00:00.000Z",
          ends_at: "2026-10-31T00:00:00.000Z",
          impressions: 0,
          clicks: 0,
          visitors: 0,
        },
      ],
      from: FROM,
      to: TO,
      slotCount: 10,
    });
    expect(performance.revenueCents).toBe(0);
    expect(performance.ecpmCents).toBe(0);
    expect(performance.bookedCents).toBe(9900);
  });

  it("derives video completion rate", () => {
    const [video] = videoEngagement([
      { video_id: "v1", slug: "v1", title: "One", starts: 100, completes: 25, likes: 8, viewers: 90 },
    ]);
    expect(video.completionRate).toBeCloseTo(0.25, 6);
    expect(videoEngagement([])).toEqual([]);
  });
});
