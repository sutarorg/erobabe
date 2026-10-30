import "server-only";
import { unstable_cache } from "next/cache";
import { tryCreateServiceClient } from "@/lib/supabase/server";
import { countryLabel } from "./geo";
import { pageLabel, referrerLabel } from "./path";
import {
  computeAdvertisingPerformance,
  trafficMetrics,
  videoEngagement,
  type AdvertisingPerformance,
  type BookedOrder,
  type PlacementDelivery,
  type SessionTotals,
  type TrafficMetrics,
  type VideoEngagement,
} from "./aggregate";
import type { AnalyticsRange } from "./range";

/**
 * Server-side readers for the admin analytics report.
 *
 * One round trip per card: the aggregation happens in Postgres (migration 28),
 * the response is memoised for a minute with `unstable_cache`, and every
 * failure mode is reported as data instead of an exception so the page can show
 * an honest empty, missing-migration or permission state.
 *
 * Nothing in this module fabricates a number. When the database is not
 * configured, the table or function is missing, or the service role is not
 * allowed to read it, the status says so and the UI renders that status.
 */

export const ANALYTICS_CACHE_SECONDS = 60;
export const ANALYTICS_CACHE_TAG = "analytics";

export type AnalyticsStatus = "ok" | "unconfigured" | "unavailable" | "forbidden" | "error";

export type AnalyticsResult<T> = {
  status: AnalyticsStatus;
  data: T | null;
  /** Operator-facing sentence; never contains a stack trace or a secret. */
  message?: string;
};

export type DimensionRow = {
  key: string;
  label: string;
  pageviews: number;
  sessions: number;
  visitors: number;
  engagedSeconds: number;
  /** Share of the range's sessions, 0–1. */
  share: number;
};

export type SeriesPoint = {
  bucket: string;
  pageviews: number;
  sessions: number;
  visitors: number;
  engagedSeconds: number;
};

export type AdvertisingSummary = {
  impressions: number;
  clicks: number;
  ctr: number;
  revenueCents: number;
  ecpmCents: number;
  fillRate: number;
};

export type OverviewData = {
  totals: TrafficMetrics;
  previous: TrafficMetrics;
  series: SeriesPoint[];
  topPages: DimensionRow[];
  referrers: DimensionRow[];
  devices: DimensionRow[];
  countries: DimensionRow[];
  advertising: AdvertisingSummary;
};

export type TrafficData = {
  totals: TrafficMetrics;
  previous: TrafficMetrics;
  series: SeriesPoint[];
  pages: DimensionRow[];
  referrers: DimensionRow[];
  referrerPaths: DimensionRow[];
  entries: DimensionRow[];
  exits: DimensionRow[];
  campaigns: DimensionRow[];
};

export type AudienceData = {
  totals: TrafficMetrics;
  devices: DimensionRow[];
  browsers: DimensionRow[];
  operatingSystems: DimensionRow[];
  countries: DimensionRow[];
  regions: DimensionRow[];
  cities: DimensionRow[];
};

export type EngagementData = {
  totals: TrafficMetrics;
  previous: TrafficMetrics;
  series: SeriesPoint[];
  videos: VideoEngagement[];
  pages: DimensionRow[];
};

export type AdvertisingData = {
  performance: AdvertisingPerformance;
  series: Array<{ bucket: string; impressions: number; clicks: number }>;
};

export type PageDetailData = {
  path: string;
  pageviews: number;
  sessions: number;
  visitors: number;
  engagedSeconds: number;
  entries: number;
  exits: number;
  bounces: number;
  bounceRate: number;
  averagePageSeconds: number;
  series: SeriesPoint[];
  referrers: DimensionRow[];
  countries: DimensionRow[];
};

export type AdOrderDetailData = {
  order: {
    id: string;
    ad_name: string;
    slot_id: number;
    status: string;
    payment_status: string;
    amount_cents: number;
    starts_at: string | null;
    ends_at: string | null;
    image_url: string;
    destination_url: string;
    created_at: string;
    email: string;
  };
  series: Array<{ bucket: string; impressions: number; clicks: number }>;
  impressions: number;
  clicks: number;
  ctr: number;
  bookedCents: number;
  revenueCents: number;
  ecpmCents: number;
};

export type TodaySnapshot = {
  pageviews: number;
  sessions: number;
  visitors: number;
  impressions: number;
  clicks: number;
  revenueCents: number;
};

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingSchema(error: any): boolean {
  const code = String(error?.code || "");
  return (
    code === "42P01" ||
    code === "42883" ||
    code === "PGRST205" ||
    code === "PGRST202" ||
    /does not exist|could not find the (table|function)/i.test(String(error?.message || ""))
  );
}

function isPermissionError(error: any): boolean {
  return (
    String(error?.code || "") === "42501" ||
    /permission denied/i.test(String(error?.message || ""))
  );
}

function failure<T>(error: any): AnalyticsResult<T> {
  if (isMissingSchema(error)) {
    return {
      status: "unavailable",
      data: null,
      message:
        "The analytics tables are not installed. Apply migration 00000000000028_analytics.sql and reload.",
    };
  }
  if (isPermissionError(error)) {
    return {
      status: "forbidden",
      data: null,
      message:
        "The service role cannot read the analytics tables. Re-apply the grants in migration 00000000000028_analytics.sql.",
    };
  }
  return {
    status: "error",
    data: null,
    message: "Analytics could not be loaded right now. Try again in a moment.",
  };
}

/**
 * `unstable_cache` needs Next's incremental cache. Outside a request (a unit
 * test, a script) it is unavailable, so the loader simply runs uncached rather
 * than failing.
 */
async function cached<T>(key: string[], load: () => Promise<T>): Promise<T> {
  try {
    return await unstable_cache(load, key, {
      revalidate: ANALYTICS_CACHE_SECONDS,
      tags: [ANALYTICS_CACHE_TAG],
    })();
  } catch {
    return load();
  }
}

type Db = NonNullable<ReturnType<typeof tryCreateServiceClient>>;

async function rpcRows(db: Db, name: string, args: Record<string, unknown>): Promise<any[]> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function dimensionRows(
  rows: any[],
  totalSessions: number,
  label: (key: string) => string,
): DimensionRow[] {
  return rows.map((row) => {
    const key = String(row.key ?? "");
    const sessions = numeric(row.sessions);
    return {
      key,
      label: label(key),
      pageviews: numeric(row.pageviews),
      sessions,
      visitors: numeric(row.visitors),
      engagedSeconds: numeric(row.engaged_seconds),
      share: totalSessions > 0 ? sessions / totalSessions : 0,
    };
  });
}

function seriesRows(rows: any[]): SeriesPoint[] {
  return rows.map((row) => ({
    bucket: new Date(row.bucket).toISOString(),
    pageviews: numeric(row.pageviews),
    sessions: numeric(row.sessions),
    visitors: numeric(row.visitors),
    engagedSeconds: numeric(row.engaged_seconds),
  }));
}

async function totalsFor(db: Db, range: AnalyticsRange, previous = false): Promise<SessionTotals> {
  const rows = await rpcRows(db, "analytics_overview", {
    p_from: previous ? range.previousFromIso : range.fromIso,
    p_to: previous ? range.previousToIso : range.toIso,
    p_path: null,
  });
  const row = rows[0] ?? {};
  return {
    pageviews: numeric(row.pageviews),
    sessions: numeric(row.sessions),
    visitors: numeric(row.visitors),
    engagedSessions: numeric(row.engaged_sessions),
    bounces: numeric(row.bounces),
    engagedSeconds: numeric(row.engaged_seconds),
  };
}

async function adPerformanceCore(
  db: Db,
  range: AnalyticsRange,
  options: { withPlacements: boolean },
): Promise<{
  performance: AdvertisingPerformance;
  series: Array<{ bucket: string; impressions: number; clicks: number }>;
}> {
  const [totalsRows, placementRows, orderRows, seriesRowsRaw] = await Promise.all([
    rpcRows(db, "analytics_ad_totals", { p_from: range.fromIso, p_to: range.toIso }),
    options.withPlacements
      ? rpcRows(db, "analytics_ad_placements", { p_from: range.fromIso, p_to: range.toIso })
      : Promise.resolve([]),
    rpcRows(db, "analytics_ad_orders", { p_from: range.fromIso, p_to: range.toIso }),
    rpcRows(db, "analytics_ad_series", {
      p_from: range.fromIso,
      p_to: range.toIso,
      p_order: null,
    }),
  ]);

  const totals = totalsRows[0] ?? {};
  const placements: PlacementDelivery[] = placementRows.map((row) => ({
    slot_id: numeric(row.slot_id),
    slot_name: String(row.slot_name ?? `Slot ${row.slot_id}`),
    side: String(row.side ?? ""),
    impressions: numeric(row.impressions),
    clicks: numeric(row.clicks),
    visitors: numeric(row.visitors),
  }));
  const orders: BookedOrder[] = orderRows.map((row) => ({
    order_id: String(row.order_id),
    ad_name: String(row.ad_name ?? "Advertisement"),
    slot_id: numeric(row.slot_id),
    status: String(row.status ?? ""),
    payment_status: String(row.payment_status ?? ""),
    amount_cents: numeric(row.amount_cents),
    starts_at: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    ends_at: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    impressions: numeric(row.impressions),
    clicks: numeric(row.clicks),
    visitors: numeric(row.visitors),
  }));

  return {
    performance: computeAdvertisingPerformance({
      totals: {
        impressions: numeric(totals.impressions),
        clicks: numeric(totals.clicks),
        visitors: numeric(totals.visitors),
      },
      placements,
      orders,
      from: range.from,
      to: range.to,
      slotCount: 10,
    }),
    series: seriesRowsRaw.map((row) => ({
      bucket: new Date(row.bucket).toISOString(),
      impressions: numeric(row.impressions),
      clicks: numeric(row.clicks),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Public readers                                                      */
/* ------------------------------------------------------------------ */

export async function loadAnalyticsOverview(range: AnalyticsRange): Promise<AnalyticsResult<OverviewData>> {
  const db = tryCreateServiceClient();
  if (!db) return { status: "unconfigured", data: null };

  return cached(["analytics-overview", range.fromIso, range.toIso], async () => {
    try {
      const [totals, previous, series, pages, referrers, devices, countries, ads] = await Promise.all([
        totalsFor(db, range),
        totalsFor(db, range, true),
        rpcRows(db, "analytics_series", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_bucket: range.bucket,
          p_path: null,
        }),
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: "path",
          p_limit: 8,
          p_path: null,
        }),
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: "referrer_host",
          p_limit: 6,
          p_path: null,
        }),
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: "device",
          p_limit: 4,
          p_path: null,
        }),
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: "country",
          p_limit: 6,
          p_path: null,
        }),
        adPerformanceCore(db, range, { withPlacements: false }),
      ]);

      const metrics = trafficMetrics(totals);
      return {
        status: "ok" as const,
        data: {
          totals: metrics,
          previous: trafficMetrics(previous),
          series: seriesRows(series),
          topPages: dimensionRows(pages, metrics.sessions, pageLabel),
          referrers: dimensionRows(referrers, metrics.sessions, referrerLabel),
          devices: dimensionRows(devices, metrics.sessions, (key) => key),
          countries: dimensionRows(countries, metrics.sessions, countryLabel),
          advertising: {
            impressions: ads.performance.impressions,
            clicks: ads.performance.clicks,
            ctr: ads.performance.ctr,
            revenueCents: ads.performance.revenueCents,
            ecpmCents: ads.performance.ecpmCents,
            fillRate: ads.performance.fillRate,
          },
        } satisfies OverviewData,
      };
    } catch (error) {
      return failure<OverviewData>(error);
    }
  });
}

export async function loadAnalyticsTraffic(range: AnalyticsRange): Promise<AnalyticsResult<TrafficData>> {
  const db = tryCreateServiceClient();
  if (!db) return { status: "unconfigured", data: null };

  return cached(["analytics-traffic", range.fromIso, range.toIso], async () => {
    try {
      const dimension = (name: string, limit = 25) =>
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: name,
          p_limit: limit,
          p_path: null,
        });
      const [totals, previous, series, pages, referrers, referrerPaths, entries, exits, campaigns] =
        await Promise.all([
          totalsFor(db, range),
          totalsFor(db, range, true),
          rpcRows(db, "analytics_series", {
            p_from: range.fromIso,
            p_to: range.toIso,
            p_bucket: range.bucket,
            p_path: null,
          }),
          dimension("path", 100),
          dimension("referrer_host", 50),
          dimension("referrer_path", 50),
          dimension("entry_path", 50),
          dimension("exit_path", 50),
          dimension("utm_source", 50),
        ]);

      const metrics = trafficMetrics(totals);
      return {
        status: "ok" as const,
        data: {
          totals: metrics,
          previous: trafficMetrics(previous),
          series: seriesRows(series),
          pages: dimensionRows(pages, metrics.sessions, pageLabel),
          referrers: dimensionRows(referrers, metrics.sessions, referrerLabel),
          referrerPaths: dimensionRows(referrerPaths, metrics.sessions, (key) => key),
          entries: dimensionRows(entries, metrics.sessions, pageLabel),
          exits: dimensionRows(exits, metrics.sessions, pageLabel),
          campaigns: dimensionRows(campaigns, metrics.sessions, (key) => key),
        } satisfies TrafficData,
      };
    } catch (error) {
      return failure<TrafficData>(error);
    }
  });
}

export async function loadAnalyticsAudience(range: AnalyticsRange): Promise<AnalyticsResult<AudienceData>> {
  const db = tryCreateServiceClient();
  if (!db) return { status: "unconfigured", data: null };

  return cached(["analytics-audience", range.fromIso, range.toIso], async () => {
    try {
      const dimension = (name: string, limit = 25) =>
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: name,
          p_limit: limit,
          p_path: null,
        });
      const [totals, devices, browsers, systems, countries, regions, cities] = await Promise.all([
        totalsFor(db, range),
        dimension("device", 10),
        dimension("browser", 25),
        dimension("os", 25),
        dimension("country", 50),
        dimension("region", 50),
        dimension("city", 50),
      ]);

      const metrics = trafficMetrics(totals);
      return {
        status: "ok" as const,
        data: {
          totals: metrics,
          devices: dimensionRows(devices, metrics.sessions, (key) => key),
          browsers: dimensionRows(browsers, metrics.sessions, (key) => key),
          operatingSystems: dimensionRows(systems, metrics.sessions, (key) => key),
          countries: dimensionRows(countries, metrics.sessions, countryLabel),
          regions: dimensionRows(regions, metrics.sessions, (key) => key),
          cities: dimensionRows(cities, metrics.sessions, (key) => key),
        } satisfies AudienceData,
      };
    } catch (error) {
      return failure<AudienceData>(error);
    }
  });
}

export async function loadAnalyticsEngagement(range: AnalyticsRange): Promise<AnalyticsResult<EngagementData>> {
  const db = tryCreateServiceClient();
  if (!db) return { status: "unconfigured", data: null };

  return cached(["analytics-engagement", range.fromIso, range.toIso], async () => {
    try {
      const [totals, previous, series, videos, pages] = await Promise.all([
        totalsFor(db, range),
        totalsFor(db, range, true),
        rpcRows(db, "analytics_series", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_bucket: range.bucket,
          p_path: null,
        }),
        rpcRows(db, "analytics_video_engagement", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_limit: 25,
        }),
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: "path",
          p_limit: 50,
          p_path: null,
        }),
      ]);

      const metrics = trafficMetrics(totals);
      return {
        status: "ok" as const,
        data: {
          totals: metrics,
          previous: trafficMetrics(previous),
          series: seriesRows(series),
          videos: videoEngagement(
            videos.map((row) => ({
              video_id: String(row.video_id),
              slug: String(row.slug ?? ""),
              title: String(row.title ?? "Untitled"),
              starts: numeric(row.starts),
              completes: numeric(row.completes),
              likes: numeric(row.likes),
              viewers: numeric(row.viewers),
            })),
          ),
          pages: dimensionRows(pages, metrics.sessions, pageLabel),
        } satisfies EngagementData,
      };
    } catch (error) {
      return failure<EngagementData>(error);
    }
  });
}

export async function loadAnalyticsAdvertising(
  range: AnalyticsRange,
): Promise<AnalyticsResult<AdvertisingData>> {
  const db = tryCreateServiceClient();
  if (!db) return { status: "unconfigured", data: null };

  return cached(["analytics-advertising", range.fromIso, range.toIso], async () => {
    try {
      const { performance, series } = await adPerformanceCore(db, range, { withPlacements: true });
      return { status: "ok" as const, data: { performance, series } satisfies AdvertisingData };
    } catch (error) {
      return failure<AdvertisingData>(error);
    }
  });
}

export async function loadAnalyticsPage(
  path: string,
  range: AnalyticsRange,
): Promise<AnalyticsResult<PageDetailData>> {
  const db = tryCreateServiceClient();
  if (!db) return { status: "unconfigured", data: null };

  return cached(["analytics-page", path, range.fromIso, range.toIso], async () => {
    try {
      const [metricsRows, series, referrers, countries] = await Promise.all([
        rpcRows(db, "analytics_page_metrics", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_path: path,
        }),
        rpcRows(db, "analytics_series", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_bucket: range.bucket,
          p_path: path,
        }),
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: "referrer_host",
          p_limit: 25,
          p_path: path,
        }),
        rpcRows(db, "analytics_dimensions", {
          p_from: range.fromIso,
          p_to: range.toIso,
          p_dimension: "country",
          p_limit: 25,
          p_path: path,
        }),
      ]);

      const row = metricsRows[0] ?? {};
      const pageviews = numeric(row.pageviews);
      const sessions = numeric(row.sessions);
      return {
        status: "ok" as const,
        data: {
          path,
          pageviews,
          sessions,
          visitors: numeric(row.visitors),
          engagedSeconds: numeric(row.engaged_seconds),
          entries: numeric(row.entries),
          exits: numeric(row.exits),
          bounces: numeric(row.bounces),
          bounceRate: sessions > 0 ? numeric(row.bounces) / sessions : 0,
          averagePageSeconds: pageviews > 0 ? numeric(row.engaged_seconds) / pageviews : 0,
          series: seriesRows(series),
          referrers: dimensionRows(referrers, sessions, referrerLabel),
          countries: dimensionRows(countries, sessions, countryLabel),
        } satisfies PageDetailData,
      };
    } catch (error) {
      return failure<PageDetailData>(error);
    }
  });
}

export async function loadAnalyticsAdOrder(
  id: string,
  range: AnalyticsRange,
): Promise<AnalyticsResult<AdOrderDetailData | null>> {
  const db = tryCreateServiceClient();
  if (!db) return { status: "unconfigured", data: null };

  return cached(["analytics-ad-order", id, range.fromIso, range.toIso], async () => {
    try {
      const { data: order, error } = await db
        .from("ad_orders")
        .select(
          "id, ad_name, slot_id, status, payment_status, amount_cents, starts_at, ends_at, image_url, destination_url, created_at, email",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!order) return { status: "ok" as const, data: null };

      const seriesRowsRaw = await rpcRows(db, "analytics_ad_series", {
        p_from: range.fromIso,
        p_to: range.toIso,
        p_order: id,
      });
      const series = seriesRowsRaw.map((row) => ({
        bucket: new Date(row.bucket).toISOString(),
        impressions: numeric(row.impressions),
        clicks: numeric(row.clicks),
      }));
      const impressions = series.reduce((sum, row) => sum + row.impressions, 0);
      const clicks = series.reduce((sum, row) => sum + row.clicks, 0);
      const bookedCents = prorated(order.amount_cents, order.starts_at, order.ends_at, range);
      const verified = order.payment_status === "verified" && order.status !== "rejected";

      return {
        status: "ok" as const,
        data: {
          order: {
            id: String(order.id),
            ad_name: String(order.ad_name ?? "Advertisement"),
            slot_id: numeric(order.slot_id),
            status: String(order.status ?? ""),
            payment_status: String(order.payment_status ?? ""),
            amount_cents: numeric(order.amount_cents),
            starts_at: order.starts_at ? new Date(order.starts_at).toISOString() : null,
            ends_at: order.ends_at ? new Date(order.ends_at).toISOString() : null,
            image_url: String(order.image_url ?? ""),
            destination_url: String(order.destination_url ?? ""),
            created_at: new Date(order.created_at).toISOString(),
            email: String(order.email ?? ""),
          },
          series,
          impressions,
          clicks,
          ctr: impressions > 0 ? clicks / impressions : 0,
          bookedCents,
          revenueCents: verified ? bookedCents : 0,
          ecpmCents: impressions > 0 ? ((verified ? bookedCents : 0) / impressions) * 1000 : 0,
        } satisfies AdOrderDetailData,
      };
    } catch (error) {
      return failure<AdOrderDetailData | null>(error);
    }
  });
}

function prorated(
  amountCents: unknown,
  startsAt: unknown,
  endsAt: unknown,
  range: AnalyticsRange,
): number {
  const amount = numeric(amountCents);
  const start = startsAt ? Date.parse(String(startsAt)) : NaN;
  const end = endsAt ? Date.parse(String(endsAt)) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const overlap = Math.max(
    0,
    Math.min(end, range.to.getTime()) - Math.max(start, range.from.getTime()),
  );
  if (overlap <= 0) return 0;
  return Math.round((amount * overlap) / (end - start));
}

/** Two cheap aggregates for the dashboard's "Traffic today" card. */
export async function loadAnalyticsToday(
  range: AnalyticsRange,
): Promise<AnalyticsResult<TodaySnapshot>> {
  const db = tryCreateServiceClient();
  if (!db) return { status: "unconfigured", data: null };

  return cached(["analytics-today", range.fromIso, range.toIso], async () => {
    try {
      const [totals, ads] = await Promise.all([
        totalsFor(db, range),
        adPerformanceCore(db, range, { withPlacements: false }),
      ]);
      return {
        status: "ok" as const,
        data: {
          pageviews: totals.pageviews,
          sessions: totals.sessions,
          visitors: totals.visitors,
          impressions: ads.performance.impressions,
          clicks: ads.performance.clicks,
          revenueCents: ads.performance.revenueCents,
        } satisfies TodaySnapshot,
      };
    } catch (error) {
      return failure<TodaySnapshot>(error);
    }
  });
}
