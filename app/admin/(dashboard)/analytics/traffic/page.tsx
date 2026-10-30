import { formatDuration, formatPercent, percentChange } from "@/lib/analytics/metrics";
import { parseAnalyticsRange, rangeQuery } from "@/lib/analytics/range";
import { loadAnalyticsTraffic } from "@/lib/analytics/queries";
import AnalyticsHeader from "@/src/components/analytics/AnalyticsHeader";
import BreakdownList from "@/src/components/analytics/BreakdownList";
import DataTable, { type TableColumn } from "@/src/components/analytics/DataTable";
import KpiCard from "@/src/components/analytics/KpiCard";
import Panel from "@/src/components/analytics/Panel";
import { AnalyticsState, EmptyTraffic } from "@/src/components/analytics/StatePanel";
import TimeSeriesChart from "@/src/components/analytics/TimeSeriesChart";

export const metadata = { title: "Analytics traffic" };

const pageColumns: TableColumn[] = [
  { key: "label", label: "Page", kind: "text", linkKey: "href" },
  { key: "key", label: "Path", kind: "text", secondary: true },
  { key: "pageviews", label: "Pageviews", kind: "number" },
  { key: "sessions", label: "Sessions", kind: "number" },
  { key: "visitors", label: "Visitors", kind: "number" },
  { key: "share", label: "Share", kind: "percent" },
];

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = parseAnalyticsRange(await searchParams);
  const result = await loadAnalyticsTraffic(range);
  const exportHref = `/api/admin/analytics/export?section=traffic&${rangeQuery(range)}`;

  return (
    <div className="space-y-4">
      <AnalyticsHeader
        title="Traffic"
        subtitle="Every public pageview, where sessions started, and which pages ended them."
        range={range}
        exportHref={exportHref}
      />

      {result.status !== "ok" || !result.data ? (
        <AnalyticsState status={result.status === "ok" ? "error" : result.status} message={result.message} />
      ) : (
        <TrafficReport range={range} data={result.data} />
      )}
    </div>
  );
}

function TrafficReport({
  range,
  data,
}: {
  range: ReturnType<typeof parseAnalyticsRange>;
  data: NonNullable<Awaited<ReturnType<typeof loadAnalyticsTraffic>>["data"]>;
}) {
  const empty = data.totals.sessions === 0;
  const compared = "vs previous period";
  const pageRows = data.pages.map((row) => ({
    id: row.key,
    label: row.label,
    key: row.key,
    href: `/admin/analytics/pages${row.key === "/" ? "" : row.key}?${rangeQuery(range)}`,
    pageviews: row.pageviews,
    sessions: row.sessions,
    visitors: row.visitors,
    share: row.share,
  }));

  return (
    <div className="space-y-4">
      {empty && <EmptyTraffic />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          label="Unique visitors"
          value={data.totals.visitors.toLocaleString("en-US")}
          delta={percentChange(data.totals.visitors, data.previous.visitors)}
          comparedTo={compared}
        />
        <KpiCard
          label="Pages / session"
          value={data.totals.pagesPerSession.toFixed(2)}
          delta={percentChange(data.totals.pagesPerSession, data.previous.pagesPerSession)}
          comparedTo={compared}
        />
      </div>

      <Panel title="Traffic over time" subtitle="UTC buckets; hover, tap or use the arrow keys to read any point.">
        <TimeSeriesChart points={data.series} bucket={range.bucket} title="Pageviews and sessions" />
      </Panel>

      <Panel title="Top pages" subtitle="Sortable; open a page for its own report and CSV.">
        <DataTable
          columns={pageColumns}
          rows={pageRows}
          caption="Pages by pageviews"
          initialSort={{ key: "pageviews", direction: "desc" }}
          csvHref={`/api/admin/analytics/export?section=traffic&${rangeQuery(range)}`}
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Referrers" subtitle="Session acquisition">
          <BreakdownList rows={data.referrers} limit={10} />
        </Panel>
        <Panel title="Referrer pages" subtitle="Path behind the referrer">
          <BreakdownList rows={data.referrerPaths} limit={10} />
        </Panel>
        <Panel title="Campaigns" subtitle="utm_source on landing">
          <BreakdownList rows={data.campaigns} limit={10} emptyLabel="No campaign tags recorded" />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Entry pages" subtitle="Where sessions began">
          <BreakdownList rows={data.entries} limit={10} />
        </Panel>
        <Panel title="Exit pages" subtitle="Where sessions ended">
          <BreakdownList rows={data.exits} limit={10} />
        </Panel>
      </div>

      <Panel title="Session quality" subtitle="Range totals">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Avg. session", formatDuration(data.totals.averageSessionSeconds)],
            ["Avg. time on page", formatDuration(data.totals.averagePageSeconds)],
            ["Bounce rate", formatPercent(data.totals.bounceRate, 1)],
            ["Engaged sessions", formatPercent(data.totals.engagementRate, 1)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-line bg-void px-3 py-2">
              <dt className="text-[10.5px] uppercase tracking-wider text-ink-3">{label}</dt>
              <dd className="mt-1 text-[15px] font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
