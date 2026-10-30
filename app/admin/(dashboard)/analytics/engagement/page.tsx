import { formatDuration, formatPercent, percentChange } from "@/lib/analytics/metrics";
import { parseAnalyticsRange, rangeQuery } from "@/lib/analytics/range";
import { loadAnalyticsEngagement } from "@/lib/analytics/queries";
import AnalyticsHeader from "@/src/components/analytics/AnalyticsHeader";
import DataTable, { type TableColumn } from "@/src/components/analytics/DataTable";
import KpiCard from "@/src/components/analytics/KpiCard";
import Panel from "@/src/components/analytics/Panel";
import { AnalyticsState, EmptyTraffic } from "@/src/components/analytics/StatePanel";
import TimeSeriesChart from "@/src/components/analytics/TimeSeriesChart";

export const metadata = { title: "Analytics engagement" };

const videoColumns: TableColumn[] = [
  { key: "title", label: "Video", kind: "text", linkKey: "href" },
  { key: "viewers", label: "Viewers", kind: "number" },
  { key: "starts", label: "Playback starts", kind: "number" },
  { key: "completes", label: "Completions", kind: "number" },
  { key: "completionRate", label: "Completion", kind: "percent" },
  { key: "likes", label: "Likes", kind: "number", secondary: true },
];

const pageColumns: TableColumn[] = [
  { key: "label", label: "Page", kind: "text", linkKey: "href" },
  { key: "pageviews", label: "Pageviews", kind: "number" },
  { key: "engagedSeconds", label: "Engaged time", kind: "duration" },
  { key: "visitors", label: "Visitors", kind: "number" },
];

export default async function EngagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = parseAnalyticsRange(await searchParams);
  const result = await loadAnalyticsEngagement(range);
  const exportHref = `/api/admin/analytics/export?section=engagement&${rangeQuery(range)}`;

  return (
    <div className="space-y-4">
      <AnalyticsHeader
        title="Engagement"
        subtitle="Session depth, time on page, and how far the player gets through each video. Playback events are kept for 90 days."
        range={range}
        exportHref={exportHref}
      />

      {result.status !== "ok" || !result.data ? (
        <AnalyticsState status={result.status === "ok" ? "error" : result.status} message={result.message} />
      ) : (
        <div className="space-y-4">
          {result.data.totals.sessions === 0 && <EmptyTraffic />}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Avg. session"
              value={formatDuration(result.data.totals.averageSessionSeconds)}
              delta={percentChange(
                result.data.totals.averageSessionSeconds,
                result.data.previous.averageSessionSeconds,
              )}
              comparedTo="vs previous period"
            />
            <KpiCard
              label="Avg. time on page"
              value={formatDuration(result.data.totals.averagePageSeconds)}
              delta={percentChange(
                result.data.totals.averagePageSeconds,
                result.data.previous.averagePageSeconds,
              )}
              comparedTo="vs previous period"
            />
            <KpiCard
              label="Engaged sessions"
              value={formatPercent(result.data.totals.engagementRate, 1)}
              hint="10s+ or 2+ pages"
            />
            <KpiCard
              label="Bounce rate"
              value={formatPercent(result.data.totals.bounceRate, 1)}
              hint="single-page sessions"
            />
          </div>

          <Panel title="Sessions over time" subtitle="Session starts per UTC bucket">
            <TimeSeriesChart
              points={result.data.series}
              bucket={range.bucket}
              title="Sessions and engaged sessions"
              initialSeries={["sessions", "pageviews"]}
            />
          </Panel>

          <Panel
            title="Video engagement"
            subtitle="Playback starts, completions and likes from the player's own event stream"
          >
            <DataTable
              columns={videoColumns}
              rows={result.data.videos.map((video) => ({
                id: video.video_id,
                title: video.title,
                href: `/video/${video.slug}`,
                viewers: video.viewers,
                starts: video.starts,
                completes: video.completes,
                completionRate: video.completionRate,
                likes: video.likes,
              }))}
              caption="Video engagement"
              initialSort={{ key: "starts", direction: "desc" }}
              emptyLabel="No playback events recorded in this range"
              csvHref={`/api/admin/analytics/export?section=engagement&${rangeQuery(range)}`}
            />
          </Panel>

          <Panel title="Pages by engaged time" subtitle="Where visitors actually spend time">
            <DataTable
              columns={pageColumns}
              rows={result.data.pages.map((page) => ({
                id: page.key,
                label: page.label,
                href: `/admin/analytics/pages${page.key === "/" ? "" : page.key}?${rangeQuery(range)}`,
                pageviews: page.pageviews,
                engagedSeconds: page.engagedSeconds,
                visitors: page.visitors,
              }))}
              caption="Pages by engaged time"
              initialSort={{ key: "engagedSeconds", direction: "desc" }}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
