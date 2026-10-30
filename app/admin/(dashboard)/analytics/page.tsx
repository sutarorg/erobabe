import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatCurrency, formatDuration, formatPercent, percentChange } from "@/lib/analytics/metrics";
import { parseAnalyticsRange, rangeQuery } from "@/lib/analytics/range";
import { loadAnalyticsOverview } from "@/lib/analytics/queries";
import AnalyticsHeader from "@/src/components/analytics/AnalyticsHeader";
import BreakdownList from "@/src/components/analytics/BreakdownList";
import KpiCard from "@/src/components/analytics/KpiCard";
import Panel from "@/src/components/analytics/Panel";
import StatePanel, { AnalyticsState, EmptyTraffic } from "@/src/components/analytics/StatePanel";
import TimeSeriesChart from "@/src/components/analytics/TimeSeriesChart";

export const metadata = { title: "Analytics overview" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Analytics overview: the four numbers an operator checks first, the traffic
 * curve, where the traffic came from, which pages it landed on, and how the
 * advertising is doing — all from measured rows.
 */
export default async function AnalyticsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const range = parseAnalyticsRange(await searchParams);
  const exportHref = `/api/admin/analytics/export?section=overview&${rangeQuery(range)}`;

  return (
    <div className="space-y-4">
      <AnalyticsHeader
        title="Overview"
        subtitle="Visitors, pageviews, sessions and advertising performance for the selected window."
        range={range}
        exportHref={exportHref}
      />

      {await Overview({ range })}
    </div>
  );
}

async function Overview({ range }: { range: ReturnType<typeof parseAnalyticsRange> }) {
  const result = await loadAnalyticsOverview(range);

  if (result.status !== "ok" || !result.data) {
    return <AnalyticsState status={result.status === "ok" ? "error" : result.status} message={result.message} />;
  }

  const data = result.data;
  const empty = data.totals.sessions === 0 && data.totals.pageviews === 0;
  const compared = "vs previous period";

  return (
    <div className="space-y-4">
      {empty && <EmptyTraffic />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Unique visitors"
          value={data.totals.visitors.toLocaleString("en-US")}
          delta={percentChange(data.totals.visitors, data.previous.visitors)}
          comparedTo={compared}
        />
        <KpiCard
          label="Pageviews"
          value={data.totals.pageviews.toLocaleString("en-US")}
          delta={percentChange(data.totals.pageviews, data.previous.pageviews)}
          comparedTo={compared}
        />
        <KpiCard
          label="Sessions"
          value={data.totals.sessions.toLocaleString("en-US")}
          delta={percentChange(data.totals.sessions, data.previous.sessions)}
          comparedTo={compared}
        />
        <KpiCard
          label="Avg. session"
          value={formatDuration(data.totals.averageSessionSeconds)}
          delta={percentChange(data.totals.averageSessionSeconds, data.previous.averageSessionSeconds)}
          comparedTo={compared}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Bounce rate" value={formatPercent(data.totals.bounceRate, 1)} hint="single-page sessions" />
        <KpiCard label="Pages / session" value={data.totals.pagesPerSession.toFixed(2)} hint="depth" />
        <KpiCard
          label="Engaged sessions"
          value={formatPercent(data.totals.engagementRate, 1)}
          hint="10s+ or 2+ pages"
        />
        <KpiCard
          label="Ad revenue"
          value={formatCurrency(data.advertising.revenueCents)}
          hint={`${formatPercent(data.advertising.ctr, 2)} CTR`}
          href={`/admin/analytics/advertising?${rangeQuery(range)}`}
        />
      </div>

      <Panel title="Traffic" subtitle="Pageviews, sessions and unique visitors per bucket (UTC).">
        <TimeSeriesChart points={data.series} bucket={range.bucket} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Top pages"
          subtitle="By pageviews"
          action={
            <Link href={`/admin/analytics/traffic?${rangeQuery(range)}`} className="text-[11px] text-accent">
              All traffic
            </Link>
          }
        >
          <BreakdownList
            rows={data.topPages}
            metric="pageviews"
            limit={8}
            hrefFor={(row) => `/admin/analytics/pages${row.key === "/" ? "" : row.key}?${rangeQuery(range)}`}
          />
        </Panel>

        <Panel title="Referrers" subtitle="Where sessions started">
          <BreakdownList rows={data.referrers} limit={6} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Devices" subtitle="Share of sessions">
          <BreakdownList rows={data.devices} limit={4} />
        </Panel>
        <Panel title="Countries" subtitle="Edge-resolved, coarse only">
          <BreakdownList rows={data.countries} limit={6} />
        </Panel>
      </div>

      <Panel
        title="Advertising performance"
        subtitle="Guest placements measured on viewable impressions and clicks"
        action={
          <Link
            href={`/admin/analytics/advertising?${rangeQuery(range)}`}
            className="inline-flex items-center gap-1 text-[11px] text-accent"
          >
            Placement report <ArrowRight aria-hidden className="h-3 w-3" />
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Impressions" value={data.advertising.impressions.toLocaleString("en-US")} />
          <KpiCard label="Clicks" value={data.advertising.clicks.toLocaleString("en-US")} />
          <KpiCard label="CTR" value={formatPercent(data.advertising.ctr, 2)} />
          <KpiCard label="Fill rate" value={formatPercent(data.advertising.fillRate, 1)} />
        </div>
        {data.advertising.impressions === 0 && (
          <div className="mt-3">
            <StatePanel
              title="No ad delivery recorded yet"
              body="Impressions are counted when a paid, live creative is at least half visible for one second. A vacant placement is not an impression."
            />
          </div>
        )}
      </Panel>
    </div>
  );
}
