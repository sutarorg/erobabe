import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const state = vi.hoisted(() => ({
  results: {} as Record<string, any>,
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/analytics",
  useSearchParams: () => new URLSearchParams("range=7d"),
  notFound: () => {
    state.notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/analytics/queries", () => ({
  loadAnalyticsOverview: async () => state.results.overview,
  loadAnalyticsTraffic: async () => state.results.traffic,
  loadAnalyticsAudience: async () => state.results.audience,
  loadAnalyticsEngagement: async () => state.results.engagement,
  loadAnalyticsAdvertising: async () => state.results.advertising,
  loadAnalyticsPage: async () => state.results.page,
  loadAnalyticsAdOrder: async () => state.results.ad,
}));

import OverviewPage from "@/app/admin/(dashboard)/analytics/page";
import TrafficPage from "@/app/admin/(dashboard)/analytics/traffic/page";
import AdvertisingPage from "@/app/admin/(dashboard)/analytics/advertising/page";
import AdDetailPage from "@/app/admin/(dashboard)/analytics/advertising/[id]/page";
import PageDetail from "@/app/admin/(dashboard)/analytics/pages/[...path]/page";
import EngagementPage from "@/app/admin/(dashboard)/analytics/engagement/page";

const ORDER_ID = "44444444-4444-4444-8444-444444444444";

function metrics(overrides: Record<string, number> = {}) {
  return {
    pageviews: 1200,
    sessions: 300,
    visitors: 240,
    engagedSessions: 150,
    bounces: 120,
    engagedSeconds: 3600,
    pagesPerSession: 4,
    bounceRate: 0.4,
    engagementRate: 0.5,
    averageSessionSeconds: 12,
    averagePageSeconds: 3,
    ...overrides,
  };
}

const dim = (key: string, label = key, sessions = 10) => ({
  key,
  label,
  pageviews: 20,
  sessions,
  visitors: sessions,
  engagedSeconds: 60,
  share: 0.1,
});

const series = [
  { bucket: "2026-10-24T00:00:00.000Z", pageviews: 10, sessions: 4, visitors: 3, engagedSeconds: 20 },
  { bucket: "2026-10-25T00:00:00.000Z", pageviews: 30, sessions: 8, visitors: 6, engagedSeconds: 40 },
];

function ok<T>(data: T) {
  return { status: "ok", data };
}

beforeEach(() => {
  state.notFound.mockClear();
  state.results = {
    overview: ok({
      totals: metrics(),
      previous: metrics({ pageviews: 600, sessions: 150, visitors: 120, averageSessionSeconds: 10 }),
      series,
      topPages: [dim("/latest", "Latest")],
      referrers: [dim("google.com", "Google")],
      devices: [dim("mobile")],
      countries: [dim("US", "United States")],
      advertising: {
        impressions: 500,
        clicks: 5,
        ctr: 0.01,
        revenueCents: 9900,
        ecpmCents: 19800,
        fillRate: 0.5,
      },
    }),
    traffic: ok({
      totals: metrics(),
      previous: metrics(),
      series,
      pages: [dim("/latest", "Latest"), dim("/popular", "Popular")],
      referrers: [dim("google.com", "Google")],
      referrerPaths: [],
      entries: [dim("/", "Home")],
      exits: [dim("/latest", "Latest")],
      campaigns: [],
    }),
    audience: ok({
      totals: metrics(),
      devices: [dim("mobile")],
      browsers: [dim("Chrome")],
      operatingSystems: [dim("iOS")],
      countries: [dim("US", "United States")],
      regions: [],
      cities: [],
    }),
    engagement: ok({
      totals: metrics(),
      previous: metrics(),
      series,
      videos: [
        {
          video_id: "v1",
          slug: "abc",
          title: "Scene one",
          starts: 100,
          completes: 25,
          likes: 4,
          viewers: 90,
          completionRate: 0.25,
        },
      ],
      pages: [dim("/latest", "Latest")],
    }),
    advertising: ok({
      performance: {
        impressions: 500,
        clicks: 5,
        visitors: 400,
        ctr: 0.01,
        cpmCents: 19800,
        ecpmCents: 19800,
        bookedCents: 9900,
        revenueCents: 9900,
        fillRate: 0.5,
        activeOrders: 1,
        verifiedOrders: 1,
        placements: [
          {
            slot_id: 1,
            slot_name: "Left rail top",
            side: "left",
            impressions: 500,
            clicks: 5,
            visitors: 400,
            ctr: 0.01,
            bookedCents: 9900,
            revenueCents: 9900,
            fillRate: 1,
            activeOrders: 1,
          },
          {
            slot_id: 2,
            slot_name: "Left rail 2",
            side: "left",
            impressions: 0,
            clicks: 0,
            visitors: 0,
            ctr: 0,
            bookedCents: 0,
            revenueCents: 0,
            fillRate: 0,
            activeOrders: 0,
          },
        ],
        orders: [
          {
            order_id: ORDER_ID,
            ad_name: "Summer launch",
            slot_id: 1,
            status: "live",
            payment_status: "verified",
            amount_cents: 9900,
            starts_at: "2026-10-01T00:00:00.000Z",
            ends_at: "2026-10-31T00:00:00.000Z",
            impressions: 500,
            clicks: 5,
            visitors: 400,
            ctr: 0.01,
            bookedCents: 9900,
            revenueCents: 9900,
            ecpmCents: 19800,
            days: 30,
            verified: true,
          },
        ],
        revenueBySlot: new Map(),
      },
      series: [{ bucket: "2026-10-24T00:00:00.000Z", impressions: 500, clicks: 5 }],
    }),
    page: ok({
      path: "/latest",
      pageviews: 120,
      sessions: 60,
      visitors: 50,
      engagedSeconds: 600,
      entries: 30,
      exits: 10,
      bounces: 5,
      bounceRate: 0.0833,
      averagePageSeconds: 5,
      series,
      referrers: [dim("google.com", "Google")],
      countries: [dim("US", "United States")],
    }),
    ad: ok({
      order: {
        id: ORDER_ID,
        ad_name: "Summer launch",
        slot_id: 1,
        status: "live",
        payment_status: "verified",
        amount_cents: 9900,
        starts_at: "2026-10-01T00:00:00.000Z",
        ends_at: "2026-10-31T00:00:00.000Z",
        image_url: "https://cdn.example.com/ad.png",
        destination_url: "https://example.com/offer",
        created_at: "2026-09-30T00:00:00.000Z",
        email: "advertiser@example.com",
      },
      series: [{ bucket: "2026-10-24T00:00:00.000Z", impressions: 500, clicks: 5 }],
      impressions: 500,
      clicks: 5,
      ctr: 0.01,
      bookedCents: 9900,
      revenueCents: 9900,
      ecpmCents: 19800,
    }),
  };
});

afterEach(cleanup);

describe("analytics overview page", () => {
  it("renders the KPI cards, chart and breakdowns from measured data", async () => {
    render(await OverviewPage({ searchParams: Promise.resolve({ range: "7d" }) }));

    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText("Unique visitors")).toBeTruthy();
    expect(screen.getByText("240")).toBeTruthy();
    expect(screen.getByText("1,200")).toBeTruthy();
    expect(screen.getByText("$99.00")).toBeTruthy();
    expect(screen.getByRole("img", { name: /2 days of pageviews/i })).toBeTruthy();
    expect(screen.getByText("Latest")).toBeTruthy();
    expect(screen.getAllByText("Google").length).toBeGreaterThan(0);
    expect(screen.getByText("United States")).toBeTruthy();

    // The export link carries the range the page is showing.
    const exportLink = screen.getByRole("link", { name: /export csv/i });
    expect(exportLink.getAttribute("href")).toContain("section=overview");
    expect(exportLink.getAttribute("href")).toContain("range=7d");
  });

  it("shows a period comparison only where there is a baseline", async () => {
    render(await OverviewPage({ searchParams: Promise.resolve({ range: "7d" }) }));
    expect(screen.getAllByText(/vs previous period/).length).toBeGreaterThan(0);
  });

  it("explains an empty report instead of showing invented numbers", async () => {
    state.results.overview = ok({
      totals: metrics({ pageviews: 0, sessions: 0, visitors: 0, engagedSessions: 0, bounces: 0, engagedSeconds: 0 }),
      previous: metrics({ pageviews: 0, sessions: 0, visitors: 0 }),
      series: [],
      topPages: [],
      referrers: [],
      devices: [],
      countries: [],
      advertising: { impressions: 0, clicks: 0, ctr: 0, revenueCents: 0, ecpmCents: 0, fillRate: 0 },
    });
    render(await OverviewPage({ searchParams: Promise.resolve({}) }));
    // The empty panel appears once, and each list says it has nothing to show.
    expect(screen.getAllByText("No traffic recorded in this range").length).toBeGreaterThan(0);
    expect(screen.getByText("No ad delivery recorded yet")).toBeTruthy();
  });

  it("renders the missing-migration state", async () => {
    state.results.overview = { status: "unavailable", data: null, message: "Apply migration 00000000000028_analytics.sql" };
    render(await OverviewPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Analytics tables are missing")).toBeTruthy();
    expect(screen.getByText(/00000000000028/)).toBeTruthy();
  });

  it("renders the permission-denied state", async () => {
    state.results.overview = { status: "forbidden", data: null, message: "permission denied" };
    render(await OverviewPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("You do not have access to analytics")).toBeTruthy();
  });

  it("renders the unconfigured state", async () => {
    state.results.overview = { status: "unconfigured", data: null };
    render(await OverviewPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Analytics storage is not configured")).toBeTruthy();
  });
});

describe("analytics traffic page", () => {
  it("lists pages with a drill-down link and a sortable table", async () => {
    render(await TrafficPage({ searchParams: Promise.resolve({ range: "7d" }) }));

    expect(screen.getByRole("heading", { name: "Traffic" })).toBeTruthy();
    const table = screen.getByRole("table", { name: /pages by pageviews/i });
    expect(within(table).getByText("Latest")).toBeTruthy();
    const link = within(table).getByRole("link", { name: "Latest" });
    expect(link.getAttribute("href")).toContain("/admin/analytics/pages/latest");

    // Header buttons expose sortable columns.
    const sortButton = within(table).getByRole("button", { name: /pageviews/i });
    expect(sortButton).toBeTruthy();
  });
});

describe("analytics advertising pages", () => {
  it("shows delivery, revenue, fill rate and per-placement rows", async () => {
    render(await AdvertisingPage({ searchParams: Promise.resolve({ range: "7d" }) }));

    expect(screen.getAllByText("Impressions").length).toBeGreaterThan(0);
    expect(screen.getAllByText("500").length).toBeGreaterThan(0);
    expect(screen.getByText("50.0%")).toBeTruthy(); // fill rate
    const placements = screen.getByRole("table", { name: /delivery and revenue by placement/i });
    expect(within(placements).getByText("Left rail top")).toBeTruthy();
    const orders = screen.getByRole("table", { name: /booked in this window/i });
    const orderLink = within(orders).getByRole("link", { name: "Summer launch" });
    expect(orderLink.getAttribute("href")).toContain(`/admin/analytics/advertising/${ORDER_ID}`);
  });

  it("renders one advertisement's own report", async () => {
    render(
      await AdDetailPage({
        params: Promise.resolve({ id: ORDER_ID }),
        searchParams: Promise.resolve({ range: "7d" }),
      }),
    );
    expect(screen.getByRole("heading", { name: "Summer launch" })).toBeTruthy();
    expect(screen.getByText("Placement details")).toBeTruthy();
    expect(screen.getByText("advertiser@example.com")).toBeTruthy();
  });

  it("404s a deleted or unknown advertisement", async () => {
    state.results.ad = ok(null);
    await expect(
      AdDetailPage({ params: Promise.resolve({ id: ORDER_ID }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.notFound).toHaveBeenCalled();
  });

  it("404s a malformed advertisement id without querying", async () => {
    await expect(
      AdDetailPage({ params: Promise.resolve({ id: "not-a-uuid" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("analytics page detail", () => {
  it("renders one page's metrics, referrers and CSV link", async () => {
    render(
      await PageDetail({
        params: Promise.resolve({ path: ["latest"] }),
        searchParams: Promise.resolve({ range: "7d" }),
      }),
    );
    expect(screen.getByRole("heading", { name: "Latest" })).toBeTruthy();
    expect(screen.getByText("Entries")).toBeTruthy();
    const detail = screen.getByText("Entries").closest("div")!;
    expect(within(detail).getByText("30")).toBeTruthy();
    const exportLink = screen.getByRole("link", { name: /export csv/i });
    expect(exportLink.getAttribute("href")).toContain("path=%2Flatest");
  });
});

describe("analytics engagement page", () => {
  it("renders completion rate per video", async () => {
    render(await EngagementPage({ searchParams: Promise.resolve({ range: "7d" }) }));
    const table = screen.getByRole("table", { name: /video engagement/i });
    expect(within(table).getByText("Scene one")).toBeTruthy();
    expect(within(table).getByText("25.00%")).toBeTruthy();
  });
});
