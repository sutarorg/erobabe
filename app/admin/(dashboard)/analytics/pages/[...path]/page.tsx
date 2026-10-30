import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatCount, formatDuration, formatPercent } from "@/lib/analytics/metrics";
import { pageLabel, slugToPath } from "@/lib/analytics/path";
import { parseAnalyticsRange, rangeQuery } from "@/lib/analytics/range";
import { loadAnalyticsPage } from "@/lib/analytics/queries";
import AnalyticsHeader from "@/src/components/analytics/AnalyticsHeader";
import BreakdownList from "@/src/components/analytics/BreakdownList";
import DataTable, { type TableColumn } from "@/src/components/analytics/DataTable";
import KpiCard from "@/src/components/analytics/KpiCard";
import Panel from "@/src/components/analytics/Panel";
import StatePanel, { AnalyticsState } from "@/src/components/analytics/StatePanel";
import TimeSeriesChart from "@/src/components/analytics/TimeSeriesChart";

export const metadata = { title: "Page analytics" };

const countryColumns: TableColumn[] = [
  { key: "label", label: "Country", kind: "text" },
  { key: "sessions", label: "Sessions", kind: "number" },
  { key: "visitors", label: "Visitors", kind: "number" },
  { key: "share", label: "Share", kind: "percent" },
];

/**
 * Drill-down for one public page (`/latest`, `/video/<slug>`, …).
 *
 * The path comes from the catch-all slug, decoded by Next, and is only used as
 * a parameterised SQL argument — never interpolated.
 */
export default async function PageAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path: segments } = await params;
  const path = slugToPath(segments);
  const range = parseAnalyticsRange(await searchParams);
  const result = await loadAnalyticsPage(path, range);
  const exportHref = `/api/admin/analytics/export?section=page&path=${encodeURIComponent(path)}&${rangeQuery(range)}`;

  return (
    <div className="space-y-4">
      <Link
        href={`/admin/analytics/traffic?${rangeQuery(range)}`}
        className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-3 transition hover:text-accent"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        All traffic
      </Link>

      {result.status !== "ok" || !result.data ? (
        <AnalyticsState status={result.status === "ok" ? "error" : result.status} message={result.message} />
      ) : (
        <>
          <AnalyticsHeader
            title={pageLabel(path)}
            subtitle={
              <>
                <span className="font-mono text-[11px] text-ink-2">{path}</span> · page report
              </>
            }
            range={range}
            exportHref={exportHref}
          />

          {result.data.pageviews === 0 ? (
            <StatePanel
              title="No pageviews for this path in the selected range"
              body="Either the page was not visited, or it is a private surface (dashboard, checkout, API) which is never measured."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Pageviews" value={formatCount(result.data.pageviews)} />
              <KpiCard label="Sessions" value={formatCount(result.data.sessions)} />
              <KpiCard label="Unique visitors" value={formatCount(result.data.visitors)} />
              <KpiCard
                label="Avg. time on page"
                value={formatDuration(result.data.averagePageSeconds)}
                hint={`${formatDuration(result.data.engagedSeconds)} total`}
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Entries" value={formatCount(result.data.entries)} hint="sessions that started here" />
            <KpiCard label="Exits" value={formatCount(result.data.exits)} hint="sessions that ended here" />
            <KpiCard label="Bounces" value={formatCount(result.data.bounces)} hint="single-page sessions" />
            <KpiCard label="Bounce rate" value={formatPercent(result.data.bounceRate, 1)} />
          </div>

          <Panel title="Pageviews over time" subtitle="UTC buckets">
            <TimeSeriesChart points={result.data.series} bucket={range.bucket} title={`Pageviews for ${path}`} />
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Referrers" subtitle="How visitors reached this page">
              <BreakdownList rows={result.data.referrers} limit={10} />
            </Panel>
            <Panel title="Countries" subtitle="Sessions that saw this page">
              {result.data.countries.length ? (
                <DataTable
                  columns={countryColumns}
                  rows={result.data.countries.map((row) => ({
                    id: row.key,
                    label: row.label,
                    sessions: row.sessions,
                    visitors: row.visitors,
                    share: row.share,
                  }))}
                  caption="Countries for this page"
                  defaultPageSize={10}
                />
              ) : (
                <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink-3">
                  No country data recorded for this page
                </p>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
