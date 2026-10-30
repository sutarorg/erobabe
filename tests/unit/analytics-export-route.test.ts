// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: "ok" as "ok" | "unauthorized" | "forbidden",
  results: {} as Record<string, any>,
}));

vi.mock("@/lib/video/publishing", () => ({
  requireActiveAdmin: async () => {
    if (state.admin === "unauthorized") throw new Error("Unauthorized");
    if (state.admin === "forbidden") throw new Error("Forbidden — admin only");
    return { user: { id: "admin-1" }, service: {} };
  },
  errorStatusFrom: (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    return message === "Unauthorized" ? 401 : message.startsWith("Forbidden") ? 403 : 500;
  },
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

import { GET } from "@/app/api/admin/analytics/export/route";

function request(query: string) {
  return { nextUrl: new URL(`https://erobabe.com/api/admin/analytics/export${query}`) } as any;
}

function metrics(overrides: Record<string, number> = {}) {
  return {
    pageviews: 1200,
    sessions: 300,
    visitors: 240,
    engagedSessions: 120,
    bounces: 160,
    engagedSeconds: 3600,
    pagesPerSession: 4,
    bounceRate: 0.53,
    engagementRate: 0.4,
    averageSessionSeconds: 12,
    averagePageSeconds: 3,
    ...overrides,
  };
}

const dimension = (key: string, sessions = 10) => ({
  key,
  label: key,
  pageviews: 20,
  sessions,
  visitors: sessions,
  engagedSeconds: 60,
  share: 0.1,
});

beforeEach(() => {
  state.admin = "ok";
  state.results = {
    overview: {
      status: "ok",
      data: {
        totals: metrics(),
        previous: metrics(),
        series: [],
        topPages: [],
        referrers: [],
        devices: [],
        countries: [],
        advertising: { impressions: 500, clicks: 5, ctr: 0.01, revenueCents: 9900, ecpmCents: 19800, fillRate: 0.5 },
      },
    },
    traffic: {
      status: "ok",
      data: {
        totals: metrics(),
        previous: metrics(),
        series: [],
        pages: [dimension("/latest")],
        referrers: [dimension("google.com")],
        referrerPaths: [],
        entries: [],
        exits: [],
        campaigns: [],
      },
    },
    audience: {
      status: "ok",
      data: {
        totals: metrics(),
        devices: [dimension("mobile")],
        browsers: [],
        operatingSystems: [],
        countries: [{ ...dimension("US"), label: "United States" }],
        regions: [],
        cities: [],
      },
    },
    engagement: {
      status: "ok",
      data: {
        totals: metrics(),
        previous: metrics(),
        series: [],
        videos: [
          {
            video_id: "v1",
            slug: "abc",
            title: "=HYPERLINK(\"https://evil.example\")",
            starts: 100,
            completes: 25,
            likes: 3,
            viewers: 90,
            completionRate: 0.25,
          },
        ],
        pages: [],
      },
    },
    advertising: {
      status: "ok",
      data: {
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
          placements: [],
          orders: [
            {
              order_id: "order-1",
              ad_name: "Summer launch, 16:9",
              slot_id: 3,
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
        },
        series: [],
      },
    },
    page: {
      status: "ok",
      data: {
        path: "/latest",
        pageviews: 120,
        sessions: 60,
        visitors: 50,
        engagedSeconds: 600,
        entries: 30,
        exits: 10,
        bounces: 5,
        bounceRate: 0.08,
        averagePageSeconds: 5,
        series: [],
        referrers: [],
        countries: [],
      },
    },
    ad: { status: "ok", data: null },
  };
});

describe("GET /api/admin/analytics/export", () => {
  it("refuses anonymous and non-admin callers", async () => {
    state.admin = "unauthorized";
    const anonymous = await GET(request("?section=overview"));
    expect(anonymous.status).toBe(401);

    state.admin = "forbidden";
    const forbidden = await GET(request("?section=overview"));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Active admin required" });
  });

  it("exports the overview with a BOM, CRLF rows and download headers", async () => {
    const response = await GET(request("?section=overview&range=7d"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="erobabe-analytics-overview-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/,
    );

    // Fetch decodes UTF-8 (and would strip a BOM), so check the bytes too:
    // Excel needs the BOM to detect UTF-8.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const body = await response.text();
    const lines = body.split("\r\n");
    expect(lines[0]).toBe("Metric,Value");
    expect(lines).toContain("Pageviews,1200");
    expect(lines).toContain("Unique visitors,240");
    expect(lines).toContain("Fill rate,0.5");
  });

  it("exports grouped traffic rows", async () => {
    const body = await (await GET(request("?section=traffic"))).text();
    const lines = body.split("\r\n");
    expect(lines[0]).toBe("Group,Value,Pageviews,Sessions,Visitors,Engaged seconds");
    expect(lines).toContain("Page,/latest,20,10,10,60");
    expect(lines).toContain("Referrer,google.com,20,10,10,60");
  });

  it("uses the country label, not the raw code, in the audience export", async () => {
    const body = await (await GET(request("?section=audience"))).text();
    expect(body).toContain("Country,United States,10,10,20");
  });

  it("neutralises spreadsheet formulas in exported creative names", async () => {
    const body = await (await GET(request("?section=engagement"))).text();
    expect(body).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(body).not.toContain(',=HYPERLINK');
  });

  it("quotes values that contain a comma", async () => {
    const body = await (await GET(request("?section=advertising"))).text();
    expect(body).toContain('"Summer launch, 16:9"');
  });

  it("requires a path for the page export and an existing ad for the ad export", async () => {
    expect((await GET(request("?section=page"))).status).toBe(400);
    expect((await GET(request("?section=ad&id=missing"))).status).toBe(404);
  });

  it("refuses an unknown section", async () => {
    expect((await GET(request("?section=everything"))).status).toBe(400);
  });

  it("maps loader failures onto honest status codes", async () => {
    state.results.overview = { status: "forbidden", data: null, message: "permission denied" };
    expect((await GET(request("?section=overview"))).status).toBe(403);

    state.results.overview = { status: "unavailable", data: null, message: "apply migration" };
    const missing = await GET(request("?section=overview"));
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "apply migration" });

    state.results.overview = { status: "unconfigured", data: null };
    expect((await GET(request("?section=overview"))).status).toBe(503);

    state.results.overview = { status: "error", data: null };
    expect((await GET(request("?section=overview"))).status).toBe(503);
  });

  it("clamps a hostile custom range instead of exporting a year", async () => {
    const response = await GET(request("?section=overview&range=custom&from=2020-01-01&to=2026-10-01"));
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") || "";
    expect(disposition).toMatch(/\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}/);
  });
});
