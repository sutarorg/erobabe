import { formatPercent } from "@/lib/analytics/metrics";
import { parseAnalyticsRange, rangeQuery } from "@/lib/analytics/range";
import { loadAnalyticsAudience } from "@/lib/analytics/queries";
import AnalyticsHeader from "@/src/components/analytics/AnalyticsHeader";
import DataTable, { type TableColumn } from "@/src/components/analytics/DataTable";
import KpiCard from "@/src/components/analytics/KpiCard";
import Panel from "@/src/components/analytics/Panel";
import { AnalyticsState, EmptyTraffic } from "@/src/components/analytics/StatePanel";
import { formatDuration } from "@/lib/analytics/metrics";

export const metadata = { title: "Analytics audience" };

const dimensionColumns: TableColumn[] = [
  { key: "label", label: "Value", kind: "text" },
  { key: "sessions", label: "Sessions", kind: "number" },
  { key: "visitors", label: "Visitors", kind: "number" },
  { key: "pageviews", label: "Pageviews", kind: "number" },
  { key: "share", label: "Share", kind: "percent" },
];

function rows(rows: Array<{ key: string; label: string; sessions: number; visitors: number; pageviews: number; share: number }>) {
  return rows.map((row) => ({
    id: row.key || "(not set)",
    label: row.label,
    sessions: row.sessions,
    visitors: row.visitors,
    pageviews: row.pageviews,
    share: row.share,
  }));
}

export default async function AudiencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = parseAnalyticsRange(await searchParams);
  const result = await loadAnalyticsAudience(range);
  const exportHref = `/api/admin/analytics/export?section=audience&${rangeQuery(range)}`;

  return (
    <div className="space-y-4">
      <AnalyticsHeader
        title="Audience"
        subtitle="Device class, browser, operating system and coarse geography — reduced server-side, never stored raw."
        range={range}
        exportHref={exportHref}
      />

      {result.status !== "ok" || !result.data ? (
        <AnalyticsState status={result.status === "ok" ? "error" : result.status} message={result.message} />
      ) : (
        <div className="space-y-4">
          {result.data.totals.sessions === 0 && <EmptyTraffic />}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Sessions" value={result.data.totals.sessions.toLocaleString("en-US")} />
            <KpiCard label="Unique visitors" value={result.data.totals.visitors.toLocaleString("en-US")} />
            <KpiCard
              label="Sessions / visitor"
              value={
                result.data.totals.visitors > 0
                  ? (result.data.totals.sessions / result.data.totals.visitors).toFixed(2)
                  : "—"
              }
            />
            <KpiCard
              label="Avg. session"
              value={formatDuration(result.data.totals.averageSessionSeconds)}
              hint={formatPercent(result.data.totals.engagementRate, 1) + " engaged"}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Devices" subtitle="Share of sessions">
              <DataTable
                columns={dimensionColumns}
                rows={rows(result.data.devices)}
                caption="Sessions by device"
                defaultPageSize={10}
              />
            </Panel>
            <Panel title="Browsers" subtitle="Share of sessions">
              <DataTable
                columns={dimensionColumns}
                rows={rows(result.data.browsers)}
                caption="Sessions by browser"
                defaultPageSize={10}
              />
            </Panel>
            <Panel title="Operating systems" subtitle="Share of sessions">
              <DataTable
                columns={dimensionColumns}
                rows={rows(result.data.operatingSystems)}
                caption="Sessions by operating system"
                defaultPageSize={10}
              />
            </Panel>
          </div>

          <Panel
            title="Countries"
            subtitle="Resolved from the request's edge headers; nothing is looked up from a third party."
          >
            <DataTable
              columns={dimensionColumns}
              rows={rows(result.data.countries)}
              caption="Sessions by country"
              defaultPageSize={10}
              csvHref={`/api/admin/analytics/export?section=audience&${rangeQuery(range)}`}
            />
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Regions" subtitle="First-level administrative area" >
              <DataTable
                columns={dimensionColumns}
                rows={rows(result.data.regions)}
                caption="Sessions by region"
                defaultPageSize={10}
                emptyLabel="No region data recorded"
              />
            </Panel>
            <Panel title="Cities" subtitle="City-level, when the edge provides it">
              <DataTable
                columns={dimensionColumns}
                rows={rows(result.data.cities)}
                caption="Sessions by city"
                defaultPageSize={10}
                emptyLabel="No city data recorded"
              />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
