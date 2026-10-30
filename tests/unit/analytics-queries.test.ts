// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  client: null as any,
  cacheThrows: false,
  calls: [] as Array<{ name: string; args: Record<string, any> }>,
  errors: {} as Record<string, any>,
  override: {} as Record<string, any[]>,
  order: null as any,
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    <T,>(load: () => Promise<T>) =>
    async () => {
      if (state.cacheThrows) throw new Error("Invariant: incrementalCache missing");
      return load();
    },
}));

vi.mock("@/lib/supabase/server", () => ({
  tryCreateServiceClient: () => state.client,
}));

import {
  loadAnalyticsAdOrder,
  loadAnalyticsAdvertising,
  loadAnalyticsAudience,
  loadAnalyticsEngagement,
  loadAnalyticsOverview,
  loadAnalyticsPage,
  loadAnalyticsToday,
} from "@/lib/analytics/queries";
import { parseAnalyticsRange } from "@/lib/analytics/range";

const RANGE = parseAnalyticsRange({ range: "28d" }, new Date("2026-10-30T09:15:00.000Z"));

function overviewRow(overrides: Record<string, unknown> = {}) {
  return {
    pageviews: 1200,
    sessions: 300,
    visitors: 240,
    engaged_sessions: 150,
    bounces: 120,
    engaged_seconds: 3600,
    ...overrides,
  };
}

function dimensionRow(key: string | null, sessions = 10) {
  return { key, pageviews: sessions * 2, sessions, visitors: sessions, engaged_seconds: 30 };
}

function fakeClient() {
  return {
    rpc: async (name: string, args: Record<string, any>) => {
      state.calls.push({ name, args });
      if (state.errors[name]) return { data: null, error: state.errors[name] };
      if (state.override[name]) return { data: state.override[name], error: null };
      switch (name) {
        case "analytics_overview":
          // The comparison window is the one that starts before the current one.
          return { data: [args.p_from === RANGE.fromIso ? overviewRow() : overviewRow({ pageviews: 600, sessions: 150, visitors: 120 })], error: null };
        case "analytics_series":
          return {
            data: [{ bucket: "2026-10-01T00:00:00.000Z", pageviews: 10, sessions: 4, visitors: 3, engaged_seconds: 20 }],
            error: null,
          };
        case "analytics_dimensions":
          if (args.p_dimension === "path") return { data: [dimensionRow("/latest"), dimensionRow("/")], error: null };
          if (args.p_dimension === "referrer_host") return { data: [dimensionRow("google.com"), dimensionRow(null)], error: null };
          if (args.p_dimension === "country") return { data: [dimensionRow("us")], error: null };
          return { data: [dimensionRow("mobile")], error: null };
        case "analytics_page_metrics":
          return {
            data: [{ pageviews: 120, sessions: 60, visitors: 50, engaged_seconds: 600, entries: 30, exits: 10, bounces: 5 }],
            error: null,
          };
        case "analytics_video_engagement":
          return {
            data: [{ video_id: "v1", slug: "abc", title: "Clip", starts: 100, completes: 25, likes: 4, viewers: 90 }],
            error: null,
          };
        case "analytics_ad_totals":
          return { data: [{ impressions: 500, clicks: 5, visitors: 400 }], error: null };
        case "analytics_ad_placements":
          return {
            data: [
              { slot_id: 1, slot_name: "Left rail top", side: "left", impressions: 500, clicks: 5, visitors: 400 },
              { slot_id: 2, slot_name: "Left rail 2", side: "left", impressions: 0, clicks: 0, visitors: 0 },
            ],
            error: null,
          };
        case "analytics_ad_orders":
          return {
            data: [
              {
                order_id: "44444444-4444-4444-8444-444444444444",
                ad_name: "Summer",
                slot_id: 1,
                status: "live",
                payment_status: "verified",
                amount_cents: 9900,
                starts_at: "2026-10-01T00:00:00.000Z",
                ends_at: "2026-10-31T00:00:00.000Z",
                impressions: 500,
                clicks: 5,
                visitors: 400,
              },
            ],
            error: null,
          };
        case "analytics_ad_series":
          return { data: [{ bucket: "2026-10-01T00:00:00.000Z", impressions: 500, clicks: 5 }], error: null };
        default:
          return { data: [], error: null };
      }
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.order, error: null }) }),
      }),
    }),
  };
}

beforeEach(() => {
  state.cacheThrows = false;
  state.calls = [];
  state.errors = {};
  state.override = {};
  state.order = null;
  state.client = fakeClient();
});

afterEach(() => {
  state.client = null;
});

describe("analytics loaders", () => {
  it("reports an unconfigured database instead of inventing numbers", async () => {
    state.client = null;
    const result = await loadAnalyticsOverview(RANGE);
    expect(result).toEqual({ status: "unconfigured", data: null });
  });

  it("maps overview rows onto typed metrics with previous-period comparison", async () => {
    const result = await loadAnalyticsOverview(RANGE);
    expect(result.status).toBe("ok");
    const data = result.data!;
    expect(data.totals).toMatchObject({ pageviews: 1200, sessions: 300, visitors: 240, bounces: 120 });
    expect(data.totals.pagesPerSession).toBeCloseTo(4, 6);
    expect(data.previous.pageviews).toBe(600);
    expect(data.series[0]).toMatchObject({ pageviews: 10, sessions: 4 });
    expect(data.topPages.map((row) => row.label)).toEqual(["Latest", "Home"]);
    expect(data.referrers.map((row) => row.label)).toEqual(["Google", "Direct"]);
    expect(data.countries[0].label).toBe("United States");
    expect(data.countries[0].share).toBeCloseTo(10 / 300, 6);
    expect(data.advertising).toMatchObject({ impressions: 500, clicks: 5 });
    // The $99 order overlaps most, but not all, of the window: prorated.
    expect(data.advertising.revenueCents).toBeGreaterThan(0);
    expect(data.advertising.revenueCents).toBeLessThan(9900);
  });

  it("asks the database for the current and previous windows", async () => {
    await loadAnalyticsOverview(RANGE);
    const windows = state.calls
      .filter((call) => call.name === "analytics_overview")
      .map((call) => call.args.p_from);
    expect(windows).toEqual([RANGE.fromIso, RANGE.previousFromIso]);
  });

  it("reports a missing migration as unavailable, not as zero traffic", async () => {
    state.errors.analytics_overview = { code: "42P01", message: 'relation "analytics_sessions" does not exist' };
    const result = await loadAnalyticsOverview(RANGE);
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("00000000000028");
    expect(result.data).toBeNull();
  });

  it("reports a missing function as unavailable too", async () => {
    state.errors.analytics_overview = { code: "42883", message: "function analytics_overview does not exist" };
    expect((await loadAnalyticsOverview(RANGE)).status).toBe("unavailable");
  });

  it("reports a permission problem separately from an outage", async () => {
    state.errors.analytics_overview = { code: "42501", message: "permission denied for table analytics_sessions" };
    const result = await loadAnalyticsOverview(RANGE);
    expect(result.status).toBe("forbidden");
    expect(result.message).toContain("service role");
  });

  it("reports any other failure as an error with no database detail", async () => {
    state.errors.analytics_overview = { code: "57014", message: "canceling statement due to statement timeout" };
    const result = await loadAnalyticsOverview(RANGE);
    expect(result.status).toBe("error");
    expect(result.message).not.toContain("57");
    expect(result.message).not.toContain("timeout");
  });

  it("still loads when the Next cache is unavailable (tests, scripts)", async () => {
    state.cacheThrows = true;
    const result = await loadAnalyticsOverview(RANGE);
    expect(result.status).toBe("ok");
    expect(result.data!.totals.sessions).toBe(300);
  });

  it("builds the traffic report from one dimension call per breakdown", async () => {
    const result = await loadAnalyticsOverview(RANGE);
    expect(result.status).toBe("ok");
    const dimensions = state.calls
      .filter((call) => call.name === "analytics_dimensions")
      .map((call) => call.args.p_dimension)
      .sort();
    expect(dimensions).toEqual(["country", "device", "path", "referrer_host"]);
  });

  it("builds the audience report with device, browser, OS and geography", async () => {
    const result = await loadAnalyticsAudience(RANGE);
    expect(result.status).toBe("ok");
    expect(result.data!.devices[0].key).toBe("mobile");
    const dimensions = state.calls
      .filter((call) => call.name === "analytics_dimensions")
      .map((call) => call.args.p_dimension);
    expect(new Set(dimensions)).toEqual(new Set(["device", "browser", "os", "country", "region", "city"]));
  });

  it("derives video completion rates for the engagement report", async () => {
    const result = await loadAnalyticsEngagement(RANGE);
    expect(result.data!.videos[0]).toMatchObject({ title: "Clip", starts: 100, completes: 25 });
    expect(result.data!.videos[0].completionRate).toBeCloseTo(0.25, 6);
  });

  it("computes advertising performance with prorated revenue and fill rate", async () => {
    const result = await loadAnalyticsAdvertising(RANGE);
    expect(result.status).toBe("ok");
    const performance = result.data!.performance;
    expect(performance.impressions).toBe(500);
    expect(performance.ctr).toBeCloseTo(0.01, 6);
    // 28 of the 30 order days inside the window.
    expect(performance.revenueCents).toBeGreaterThan(0);
    expect(performance.revenueCents).toBeLessThan(9900);
    expect(performance.fillRate).toBeGreaterThan(0);
    expect(performance.placements).toHaveLength(2);
  });

  it("reports page-level metrics and bounce rate", async () => {
    const result = await loadAnalyticsPage("/latest", RANGE);
    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({
      path: "/latest",
      pageviews: 120,
      sessions: 60,
      entries: 30,
      exits: 10,
      bounces: 5,
    });
    expect(result.data!.bounceRate).toBeCloseTo(5 / 60, 6);
    expect(result.data!.averagePageSeconds).toBeCloseTo(5, 6);
  });

  it("returns null for an advertisement that no longer exists", async () => {
    state.order = null;
    const result = await loadAnalyticsAdOrder("44444444-4444-4444-8444-444444444444", RANGE);
    expect(result).toEqual({ status: "ok", data: null });
  });

  it("prorates an advertisement's own revenue and only counts verified money", async () => {
    state.order = {
      id: "44444444-4444-4444-8444-444444444444",
      ad_name: "Summer",
      slot_id: 1,
      status: "live",
      payment_status: "verified",
      amount_cents: 9900,
      starts_at: "2026-10-01T00:00:00.000Z",
      ends_at: "2026-10-31T00:00:00.000Z",
      image_url: "https://cdn.example.com/a.png",
      destination_url: "https://example.com",
      created_at: "2026-09-30T00:00:00.000Z",
      email: "advertiser@example.com",
    };
    const verified = await loadAnalyticsAdOrder(state.order.id, RANGE);
    expect(verified.data!.impressions).toBe(500);
    expect(verified.data!.revenueCents).toBeGreaterThan(0);
    expect(verified.data!.ctr).toBeCloseTo(0.01, 6);

    state.order = { ...state.order, payment_status: "unverified" };
    const unpaid = await loadAnalyticsAdOrder(state.order.id, RANGE);
    expect(unpaid.data!.revenueCents).toBe(0);
    expect(unpaid.data!.bookedCents).toBeGreaterThan(0);
  });

  it("gives the dashboard a two-aggregate snapshot", async () => {
    const result = await loadAnalyticsToday(RANGE);
    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ visitors: 240, sessions: 300, impressions: 500, clicks: 5 });
    expect(state.calls.some((call) => call.name === "analytics_ad_placements")).toBe(false);
  });
});
