/**
 * Pure aggregation on top of the SQL aggregates.
 *
 * The database returns counts; the ratios an operator reads (pages per
 * session, bounce rate, CTR, CPM, eCPM, fill rate, prorated revenue) are
 * computed here so the cards, the tables, the CSV export and the tests all use
 * exactly one implementation.
 */

import {
  cpmCents,
  ctr,
  ecpmCents,
  fillRate,
  proratedAmountCents,
  safeRatio,
} from "./metrics";

export type SessionTotals = {
  pageviews: number;
  sessions: number;
  visitors: number;
  engagedSessions: number;
  bounces: number;
  engagedSeconds: number;
};

export type TrafficMetrics = SessionTotals & {
  pagesPerSession: number;
  bounceRate: number;
  engagementRate: number;
  averageSessionSeconds: number;
  averagePageSeconds: number;
};

export function trafficMetrics(totals: SessionTotals): TrafficMetrics {
  const sessions = Math.max(0, totals.sessions);
  return {
    ...totals,
    pagesPerSession: safeRatio(totals.pageviews, sessions),
    bounceRate: safeRatio(totals.bounces, sessions),
    engagementRate: safeRatio(totals.engagedSessions, sessions),
    averageSessionSeconds: safeRatio(totals.engagedSeconds, sessions),
    averagePageSeconds: safeRatio(totals.engagedSeconds, totals.pageviews),
  };
}

export type AdTotals = { impressions: number; clicks: number; visitors: number };

export type PlacementDelivery = {
  slot_id: number;
  slot_name: string;
  side: string;
  impressions: number;
  clicks: number;
  visitors: number;
};

export type BookedOrder = {
  order_id: string;
  ad_name: string;
  slot_id: number;
  status: string;
  payment_status: string;
  amount_cents: number;
  starts_at: string | null;
  ends_at: string | null;
  impressions: number;
  clicks: number;
  visitors: number;
};

export type PlacementPerformance = PlacementDelivery & {
  ctr: number;
  bookedCents: number;
  revenueCents: number;
  /** Share of this placement's days in the range that an ad occupied. */
  fillRate: number;
  activeOrders: number;
};

export type OrderPerformance = BookedOrder & {
  ctr: number;
  /** Contracted value attributed to the selected window. */
  bookedCents: number;
  /** Verified value attributed to the selected window. */
  revenueCents: number;
  ecpmCents: number;
  /** Days of the order inside the selected window. */
  days: number;
  verified: boolean;
};

export type AdvertisingPerformance = {
  impressions: number;
  clicks: number;
  visitors: number;
  ctr: number;
  /** Advertiser cost per thousand impressions for the booked value. */
  cpmCents: number;
  /** Publisher revenue per thousand impressions, verified orders only. */
  ecpmCents: number;
  bookedCents: number;
  revenueCents: number;
  fillRate: number;
  activeOrders: number;
  verifiedOrders: number;
  placements: PlacementPerformance[];
  orders: OrderPerformance[];
  revenueBySlot: Map<number, number>;
};

function countValue(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** True when an order's money is real: paid and not rejected. */
export function isVerifiedOrder(order: { payment_status: string; status: string }): boolean {
  return order.payment_status === "verified" && order.status !== "rejected";
}

export function computeAdvertisingPerformance(input: {
  totals: AdTotals;
  placements: PlacementDelivery[];
  orders: BookedOrder[];
  from: Date;
  to: Date;
  slotCount: number;
}): AdvertisingPerformance {
  const { from, to } = input;

  const orders: OrderPerformance[] = input.orders.map((order) => {
    const verified = isVerifiedOrder(order);
    const bookedCents = proratedAmountCents(order.amount_cents, order.starts_at, order.ends_at, from, to);
    const revenueCents = verified ? bookedCents : 0;
    const start = order.starts_at ? Date.parse(order.starts_at) : NaN;
    const end = order.ends_at ? Date.parse(order.ends_at) : NaN;
    const days =
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? Math.max(
            0,
            (Math.min(end, to.getTime()) - Math.max(start, from.getTime())) / 86_400_000,
          )
        : 0;
    return {
      ...order,
      impressions: countValue(order.impressions),
      clicks: countValue(order.clicks),
      visitors: countValue(order.visitors),
      ctr: ctr(countValue(order.clicks), countValue(order.impressions)),
      bookedCents,
      revenueCents,
      ecpmCents: ecpmCents(revenueCents, countValue(order.impressions)),
      days: Math.round(days * 10) / 10,
      verified,
    };
  });

  const revenueBySlot = new Map<number, number>();
  const bookedBySlot = new Map<number, number>();
  const ctrBySlot = new Map<number, number>();
  const impressionsBySlot = new Map<number, number>();
  const clicksBySlot = new Map<number, number>();
  const visitorsBySlot = new Map<number, number>();
  const activeBySlot = new Map<number, number>();

  for (const order of orders) {
    revenueBySlot.set(order.slot_id, (revenueBySlot.get(order.slot_id) ?? 0) + order.revenueCents);
    bookedBySlot.set(order.slot_id, (bookedBySlot.get(order.slot_id) ?? 0) + order.bookedCents);
    ctrBySlot.set(order.slot_id, (ctrBySlot.get(order.slot_id) ?? 0) + order.clicks);
    impressionsBySlot.set(
      order.slot_id,
      (impressionsBySlot.get(order.slot_id) ?? 0) + order.impressions,
    );
    clicksBySlot.set(order.slot_id, (clicksBySlot.get(order.slot_id) ?? 0) + order.clicks);
    visitorsBySlot.set(order.slot_id, (visitorsBySlot.get(order.slot_id) ?? 0) + order.visitors);
    if (order.status === "live") activeBySlot.set(order.slot_id, (activeBySlot.get(order.slot_id) ?? 0) + 1);
  }

  const placements: PlacementPerformance[] = input.placements.map((placement) => {
    // Delivery comes from the SQL aggregate (already per slot); the order-level
    // sums above are only used for money, which the event table does not carry.
    const revenueCents = revenueBySlot.get(placement.slot_id) ?? 0;
    const bookedCents = bookedBySlot.get(placement.slot_id) ?? 0;
    const slotOrders = orders.filter((order) => order.slot_id === placement.slot_id);
    return {
      ...placement,
      impressions: countValue(placement.impressions),
      clicks: countValue(placement.clicks),
      visitors: countValue(placement.visitors),
      ctr: ctr(countValue(placement.clicks), countValue(placement.impressions)),
      bookedCents,
      revenueCents,
      fillRate: fillRate(1, slotOrders, from, to),
      activeOrders: activeBySlot.get(placement.slot_id) ?? 0,
    };
  });

  const impressions = countValue(input.totals.impressions);
  const clicks = countValue(input.totals.clicks);
  const bookedCents = orders.reduce((sum, order) => sum + order.bookedCents, 0);
  const revenueCents = orders.reduce((sum, order) => sum + order.revenueCents, 0);

  return {
    impressions,
    clicks,
    visitors: countValue(input.totals.visitors),
    ctr: ctr(clicks, impressions),
    cpmCents: cpmCents(bookedCents, impressions),
    ecpmCents: ecpmCents(revenueCents, impressions),
    bookedCents,
    revenueCents,
    fillRate: fillRate(input.slotCount, orders, from, to),
    activeOrders: orders.filter((order) => order.status === "live").length,
    verifiedOrders: orders.filter((order) => order.verified).length,
    placements,
    orders: orders.sort((a, b) => b.revenueCents - a.revenueCents || b.impressions - a.impressions),
    revenueBySlot,
  };
}

export type VideoEngagement = {
  video_id: string;
  slug: string;
  title: string;
  starts: number;
  completes: number;
  likes: number;
  viewers: number;
  completionRate: number;
};

export function videoEngagement(rows: Array<Omit<VideoEngagement, "completionRate">>): VideoEngagement[] {
  return rows.map((row) => ({
    ...row,
    starts: countValue(row.starts),
    completes: countValue(row.completes),
    likes: countValue(row.likes),
    viewers: countValue(row.viewers),
    completionRate: safeRatio(countValue(row.completes), countValue(row.starts)),
  }));
}
