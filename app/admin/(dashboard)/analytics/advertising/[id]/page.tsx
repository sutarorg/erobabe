import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/analytics/metrics";
import { isoDay, parseAnalyticsRange, rangeQuery } from "@/lib/analytics/range";
import { loadAnalyticsAdOrder } from "@/lib/analytics/queries";
import AdSeriesChart from "@/src/components/analytics/AdSeriesChart";
import AnalyticsHeader from "@/src/components/analytics/AnalyticsHeader";
import KpiCard from "@/src/components/analytics/KpiCard";
import Panel from "@/src/components/analytics/Panel";
import { AnalyticsState } from "@/src/components/analytics/StatePanel";

export const metadata = { title: "Advertisement analytics" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One advertisement's report: schedule, creative, delivery, prorated revenue.
 *
 * The id is a guest order id; an id that does not exist (or a deleted ad, whose
 * row and delivery evidence are removed together) is a 404 rather than an empty
 * chart that implies zero performance.
 */
export default async function AdAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const range = parseAnalyticsRange(await searchParams);
  const result = await loadAnalyticsAdOrder(id, range);
  const exportHref = `/api/admin/analytics/export?section=ad&id=${id}&${rangeQuery(range)}`;

  if (result.status === "ok" && result.data === null) notFound();

  return (
    <div className="space-y-4">
      <Link
        href={`/admin/analytics/advertising?${rangeQuery(range)}`}
        className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-3 transition hover:text-accent"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        All advertisements
      </Link>

      {result.status !== "ok" || !result.data ? (
        <AnalyticsState status={result.status === "ok" ? "error" : result.status} message={result.message} />
      ) : (
        <>
          <AnalyticsHeader
            title={result.data.order.ad_name}
            subtitle={`Slot ${result.data.order.slot_id} · ${result.data.order.status.replaceAll("_", " ")} · payment ${result.data.order.payment_status}`}
            range={range}
            exportHref={exportHref}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Impressions" value={result.data.impressions.toLocaleString("en-US")} />
            <KpiCard
              label="Clicks"
              value={result.data.clicks.toLocaleString("en-US")}
              hint={`${formatPercent(result.data.ctr, 2)} CTR`}
            />
            <KpiCard
              label="Revenue in range"
              value={formatCurrency(result.data.revenueCents)}
              hint={`${formatCurrency(result.data.bookedCents)} booked`}
            />
            <KpiCard label="eCPM" value={formatCurrency(result.data.ecpmCents)} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel
              title="Delivery"
              subtitle="Daily UTC impressions and clicks for this advertisement"
              className="self-start"
            >
              <AdSeriesChart points={result.data.series} />
            </Panel>

            <Panel title="Placement details" subtitle="From the booking, not estimated">
              <div className="space-y-3">
                <div className="overflow-hidden rounded-md border border-line bg-void">
                  {result.data.order.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result.data.order.image_url}
                      alt={result.data.order.ad_name}
                      className="aspect-video w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center text-[11px] text-ink-3">
                      Creative removed
                    </div>
                  )}
                </div>
                <dl className="space-y-2 text-[11.5px]">
                  {[
                    ["Status", result.data.order.status.replaceAll("_", " ")],
                    ["Payment", result.data.order.payment_status],
                    ["Booked value", formatCurrency(result.data.order.amount_cents)],
                    ["Starts", formatDateTime(result.data.order.starts_at)],
                    ["Ends", formatDateTime(result.data.order.ends_at)],
                    ["Submitted", formatDateTime(result.data.order.created_at)],
                    ["Contact", result.data.order.email],
                    [
                      "Days in range",
                      `${Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000))}`,
                    ],
                    ["Range", `${isoDay(range.from)} → ${isoDay(new Date(range.to.getTime() - 60_000))}`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line/40 pb-1.5 last:border-0">
                      <dt className="text-ink-3">{label}</dt>
                      <dd className="truncate text-right text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
                {result.data.order.destination_url && (
                  <a
                    href={result.data.order.destination_url}
                    target="_blank"
                    rel="noreferrer noopener nofollow sponsored"
                    className="inline-flex items-center gap-1.5 text-[11.5px] text-accent hover:underline"
                  >
                    Open destination <ExternalLink aria-hidden className="h-3 w-3" />
                  </a>
                )}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
