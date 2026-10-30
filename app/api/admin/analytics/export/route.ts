import { NextResponse, type NextRequest } from "next/server";
import { errorStatusFrom, requireActiveAdmin } from "@/lib/video/publishing";
import { toCsv, type CsvColumn } from "@/lib/analytics/metrics";
import { isoDay, parseAnalyticsRange } from "@/lib/analytics/range";
import {
  loadAnalyticsAdOrder,
  loadAnalyticsAdvertising,
  loadAnalyticsAudience,
  loadAnalyticsEngagement,
  loadAnalyticsOverview,
  loadAnalyticsPage,
  loadAnalyticsTraffic,
  type AnalyticsResult,
} from "@/lib/analytics/queries";

/**
 * CSV export for every analytics surface.
 *
 * Admin-only, never cached, and built from exactly the loaders the page used —
 * an export can never disagree with the screen it came from. Cells are escaped
 * by `toCsv`, which also neutralises spreadsheet formula injection.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Export = { slug: string; columns: CsvColumn[]; rows: Array<Record<string, unknown>> };

const SECTIONS = [
  "overview",
  "traffic",
  "audience",
  "engagement",
  "advertising",
  "page",
  "ad",
] as const;

type Section = (typeof SECTIONS)[number];

function csvResponse(slug: string, range: ReturnType<typeof parseAnalyticsRange>, csv: string) {
  const filename = `erobabe-${slug}-${isoDay(range.from)}_${isoDay(new Date(range.to.getTime() - 60_000))}.csv`;
  return new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function failure(status: AnalyticsResult<unknown>["status"], message?: string) {
  const httpStatus =
    status === "forbidden" ? 403 : status === "unavailable" ? 409 : status === "unconfigured" ? 503 : 503;
  return NextResponse.json({ error: message || "Export unavailable" }, { status: httpStatus });
}

async function build(section: Section, range: ReturnType<typeof parseAnalyticsRange>, path: string, id: string): Promise<Export | NextResponse> {
  switch (section) {
    case "overview": {
      const result = await loadAnalyticsOverview(range);
      if (result.status !== "ok" || !result.data) return failure(result.status, result.message);
      const data = result.data;
      const rows = [
        { metric: "Pageviews", value: data.totals.pageviews },
        { metric: "Sessions", value: data.totals.sessions },
        { metric: "Unique visitors", value: data.totals.visitors },
        { metric: "Engaged sessions", value: data.totals.engagedSessions },
        { metric: "Bounce rate", value: data.totals.bounceRate },
        { metric: "Pages per session", value: data.totals.pagesPerSession },
        { metric: "Average session seconds", value: data.totals.averageSessionSeconds },
        { metric: "Ad impressions", value: data.advertising.impressions },
        { metric: "Ad clicks", value: data.advertising.clicks },
        { metric: "Ad CTR", value: data.advertising.ctr },
        { metric: "Ad revenue cents", value: data.advertising.revenueCents },
        { metric: "Fill rate", value: data.advertising.fillRate },
      ];
      return {
        slug: "analytics-overview",
        columns: [
          { key: "metric", label: "Metric" },
          { key: "value", label: "Value" },
        ],
        rows,
      };
    }

    case "traffic": {
      const result = await loadAnalyticsTraffic(range);
      if (result.status !== "ok" || !result.data) return failure(result.status, result.message);
      return {
        slug: "analytics-traffic",
        columns: [
          { key: "group", label: "Group" },
          { key: "key", label: "Value" },
          { key: "pageviews", label: "Pageviews" },
          { key: "sessions", label: "Sessions" },
          { key: "visitors", label: "Visitors" },
          { key: "engaged_seconds", label: "Engaged seconds" },
        ],
        rows: [
          ...result.data.pages.map((row) => ({ ...row, group: "Page", engaged_seconds: row.engagedSeconds })),
          ...result.data.referrers.map((row) => ({ ...row, group: "Referrer", engaged_seconds: row.engagedSeconds })),
          ...result.data.referrerPaths.map((row) => ({ ...row, group: "Referrer page", engaged_seconds: row.engagedSeconds })),
          ...result.data.entries.map((row) => ({ ...row, group: "Entry page", engaged_seconds: row.engagedSeconds })),
          ...result.data.exits.map((row) => ({ ...row, group: "Exit page", engaged_seconds: row.engagedSeconds })),
          ...result.data.campaigns.map((row) => ({ ...row, group: "Campaign", engaged_seconds: row.engagedSeconds })),
        ],
      };
    }

    case "audience": {
      const result = await loadAnalyticsAudience(range);
      if (result.status !== "ok" || !result.data) return failure(result.status, result.message);
      return {
        slug: "analytics-audience",
        columns: [
          { key: "group", label: "Group" },
          { key: "key", label: "Value" },
          { key: "sessions", label: "Sessions" },
          { key: "visitors", label: "Visitors" },
          { key: "pageviews", label: "Pageviews" },
        ],
        rows: [
          ...result.data.devices.map((row) => ({ ...row, group: "Device" })),
          ...result.data.browsers.map((row) => ({ ...row, group: "Browser" })),
          ...result.data.operatingSystems.map((row) => ({ ...row, group: "Operating system" })),
          ...result.data.countries.map((row) => ({ ...row, group: "Country", key: row.label })),
          ...result.data.regions.map((row) => ({ ...row, group: "Region" })),
          ...result.data.cities.map((row) => ({ ...row, group: "City" })),
        ],
      };
    }

    case "engagement": {
      const result = await loadAnalyticsEngagement(range);
      if (result.status !== "ok" || !result.data) return failure(result.status, result.message);
      return {
        slug: "analytics-engagement",
        columns: [
          { key: "title", label: "Video" },
          { key: "slug", label: "Slug" },
          { key: "viewers", label: "Viewers" },
          { key: "starts", label: "Playback starts" },
          { key: "completes", label: "Completions" },
          { key: "completion_rate", label: "Completion rate" },
          { key: "likes", label: "Likes" },
        ],
        rows: result.data.videos.map((video) => ({
          title: video.title,
          slug: video.slug,
          viewers: video.viewers,
          starts: video.starts,
          completes: video.completes,
          completion_rate: video.completionRate,
          likes: video.likes,
        })),
      };
    }

    case "advertising": {
      const result = await loadAnalyticsAdvertising(range);
      if (result.status !== "ok" || !result.data) return failure(result.status, result.message);
      const { performance } = result.data;
      return {
        slug: "analytics-advertising",
        columns: [
          { key: "placement", label: "Placement" },
          { key: "ad", label: "Advertisement" },
          { key: "impressions", label: "Impressions" },
          { key: "clicks", label: "Clicks" },
          { key: "ctr", label: "CTR" },
          { key: "revenue_cents", label: "Revenue (cents)" },
          { key: "ecpm_cents", label: "eCPM (cents)" },
          { key: "fill_rate", label: "Fill rate" },
          { key: "status", label: "Status" },
          { key: "starts_at", label: "Starts" },
          { key: "ends_at", label: "Ends" },
        ],
        rows: performance.orders.map((order) => ({
          placement: `Slot ${order.slot_id}`,
          ad: order.ad_name,
          impressions: order.impressions,
          clicks: order.clicks,
          ctr: order.ctr,
          revenue_cents: order.revenueCents,
          ecpm_cents: order.ecpmCents,
          fill_rate: performance.fillRate,
          status: order.status,
          starts_at: order.starts_at,
          ends_at: order.ends_at,
        })),
      };
    }

    case "page": {
      if (!path) return NextResponse.json({ error: "A page path is required" }, { status: 400 });
      const result = await loadAnalyticsPage(path, range);
      if (result.status !== "ok" || !result.data) return failure(result.status, result.message);
      const data = result.data;
      return {
        slug: "analytics-page",
        columns: [
          { key: "metric", label: "Metric" },
          { key: "value", label: "Value" },
        ],
        rows: [
          { metric: "Path", value: data.path },
          { metric: "Pageviews", value: data.pageviews },
          { metric: "Sessions", value: data.sessions },
          { metric: "Visitors", value: data.visitors },
          { metric: "Entries", value: data.entries },
          { metric: "Exits", value: data.exits },
          { metric: "Bounces", value: data.bounces },
          { metric: "Bounce rate", value: data.bounceRate },
          { metric: "Average seconds on page", value: data.averagePageSeconds },
        ],
      };
    }

    case "ad": {
      if (!id) return NextResponse.json({ error: "An advertisement id is required" }, { status: 400 });
      const result = await loadAnalyticsAdOrder(id, range);
      if (result.status !== "ok") return failure(result.status, result.message);
      if (!result.data) return NextResponse.json({ error: "Advertisement not found" }, { status: 404 });
      const data = result.data;
      return {
        slug: "analytics-ad",
        columns: [
          { key: "day", label: "Day" },
          { key: "impressions", label: "Impressions" },
          { key: "clicks", label: "Clicks" },
        ],
        rows: data.series.map((row) => ({
          day: row.bucket.slice(0, 10),
          impressions: row.impressions,
          clicks: row.clicks,
        })),
      };
    }

    default:
      return NextResponse.json({ error: "Unknown export section" }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireActiveAdmin();
  } catch (error) {
    const status = errorStatusFrom(error);
    return NextResponse.json(
      { error: status === 401 ? "Sign in required" : "Active admin required" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const params = request.nextUrl.searchParams;
  const section = String(params.get("section") || "overview") as Section;
  if (!SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Unknown export section" }, { status: 400 });
  }

  const range = parseAnalyticsRange({
    range: params.get("range"),
    from: params.get("from"),
    to: params.get("to"),
  });

  const result = await build(
    section,
    range,
    String(params.get("path") || ""),
    String(params.get("id") || ""),
  );
  if (result instanceof NextResponse) return result;
  return csvResponse(result.slug, range, toCsv(result.columns, result.rows));
}
