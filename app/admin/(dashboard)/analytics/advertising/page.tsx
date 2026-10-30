import {
  formatCurrency,
  formatPercent,
} from "@/lib/analytics/metrics";
import { parseAnalyticsRange, rangeQuery } from "@/lib/analytics/range";
import { loadAnalyticsAdvertising } from "@/lib/analytics/queries";
import AdSeriesChart from "@/src/components/analytics/AdSeriesChart";
import AnalyticsHeader from "@/src/components/analytics/AnalyticsHeader";
import DataTable, { type TableColumn } from "@/src/components/analytics/DataTable";
import KpiCard from "@/src/components/analytics/KpiCard";
import Panel from "@/src/components/analytics/Panel";
import StatePanel, { AnalyticsState } from "@/src/components/analytics/StatePanel";

export const metadata = { title: "Analytics advertising" };

const placementColumns: TableColumn[] = [
  { key: "slot", label: "Placement", kind: "text" },
  { key: "slot_name", label: "Name", kind: "text", secondary: true },
  { key: "impressions", label: "Impressions", kind: "number" },
  { key: "clicks", label: "Clicks", kind: "number" },
  { key: "ctr", label: "CTR", kind: "percent" },
  { key: "booked", label: "Booked", kind: "currency" },
  { key: "revenue", label: "Revenue", kind: "currency" },
  { key: "fill", label: "Fill", kind: "percent" },
];

const orderColumns: TableColumn[] = [
  { key: "ad_name", label: "Advertisement", kind: "text", linkKey: "href" },
  { key: "slot", label: "Slot", kind: "text" },
  { key: "status", label: "Status", kind: "text" },
  { key: "impressions", label: "Impressions", kind: "number" },
  { key: "clicks", label: "Clicks", kind: "number" },
  { key: "ctr", label: "CTR", kind: "percent" },
  { key: "revenue", label: "Revenue", kind: "currency" },
  { key: "ecpm", label: "eCPM", kind: "currency" },
  { key: "days", label: "Days in range", kind: "number", secondary: true },
];

export default async function AdvertisingAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = parseAnalyticsRange(await searchParams);
  const result = await loadAnalyticsAdvertising(range);
  const exportHref = `/api/admin/analytics/export?section=advertising&${rangeQuery(range)}`;

  return (
    <div className="space-y-4">
      <AnalyticsHeader
        title="Advertising"
        subtitle="Impressions, clicks, CTR, CPM, eCPM, fill rate and prorated revenue for the ten fixed placements."
        range={range}
        exportHref={exportHref}
      />

      {result.status !== "ok" || !result.data ? (
        <AnalyticsState status={result.status === "ok" ? "error" : result.status} message={result.message} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Impressions"
              value={result.data.performance.impressions.toLocaleString("en-US")}
              hint="viewable, deduplicated per visitor/hour"
            />
            <KpiCard
              label="Clicks"
              value={result.data.performance.clicks.toLocaleString("en-US")}
              hint={`${formatPercent(result.data.performance.ctr, 2)} CTR`}
            />
            <KpiCard
              label="Revenue"
              value={formatCurrency(result.data.performance.revenueCents)}
              hint={`${formatCurrency(result.data.performance.bookedCents)} booked`}
            />
            <KpiCard
              label="eCPM"
              value={formatCurrency(result.data.performance.ecpmCents)}
              hint={`${formatCurrency(result.data.performance.cpmCents)} booked CPM`}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Fill rate"
              value={formatPercent(result.data.performance.fillRate, 1)}
              hint="occupied placement-days"
            />
            <KpiCard
              label="Live placements"
              value={String(result.data.performance.activeOrders)}
              hint="orders live in this window"
            />
            <KpiCard
              label="Verified orders"
              value={String(result.data.performance.verifiedOrders)}
              hint="Paid, not rejected"
            />
            <KpiCard
              label="Unique reach"
              value={result.data.performance.visitors.toLocaleString("en-US")}
              hint="visitors who saw an ad"
            />
          </div>

          <Panel
            title="Delivery over time"
            subtitle="Impressions (columns) and clicks (line), daily UTC"
          >
            <AdSeriesChart points={result.data.series} />
          </Panel>

          <Panel
            title="Per-placement performance"
            subtitle="All ten placements, including ones with no delivery in this window"
          >
            <DataTable
              columns={placementColumns}
              rows={result.data.performance.placements.map((placement) => ({
                id: String(placement.slot_id),
                slot: `Slot ${placement.slot_id}`,
                slot_name: placement.slot_name,
                impressions: placement.impressions,
                clicks: placement.clicks,
                ctr: placement.ctr,
                booked: placement.bookedCents,
                revenue: placement.revenueCents,
                fill: placement.fillRate,
              }))}
              caption="Delivery and revenue by placement"
              initialSort={{ key: "impressions", direction: "desc" }}
              defaultPageSize={10}
            />
          </Panel>

          <Panel
            title="Advertisements in this window"
            subtitle="Revenue is prorated to the days of the selected range; open one for its own report"
          >
            <DataTable
              columns={orderColumns}
              rows={result.data.performance.orders.map((order) => ({
                id: order.order_id,
                ad_name: order.ad_name,
                href: `/admin/analytics/advertising/${order.order_id}?${rangeQuery(range)}`,
                slot: `Slot ${order.slot_id}`,
                status: order.status,
                impressions: order.impressions,
                clicks: order.clicks,
                ctr: order.ctr,
                revenue: order.revenueCents,
                ecpm: order.ecpmCents,
                days: order.days,
              }))}
              caption="Advertisements booked in this window"
              initialSort={{ key: "impressions", direction: "desc" }}
              emptyLabel="No advertisement was booked in this window"
              csvHref={exportHref}
            />
          </Panel>

          {result.data.performance.impressions === 0 && (
            <StatePanel
              title="No delivery measured yet"
              body="A creative is measured once it is live, paid and at least half visible for a second. The checkout's placements are sold per 30 days, so a newly approved ad starts reporting as soon as it is on a rail or a mobile banner."
            />
          )}
        </div>
      )}
    </div>
  );
}
