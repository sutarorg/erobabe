import { createServiceClient } from "@/lib/supabase/server";
import { focusFromRow, type CreativeFocus } from "@/lib/ads/focus";

/**
 * The ten fixed 16:9 placements and who currently occupies each one.
 *
 * This is the single source of truth for "is this slot sellable", used by the
 * public rails, the checkout wizard, the admin ad-slot board and the dashboard
 * overview. A slot is occupied when a guest order is in review / live / paused
 * and has not expired, or when a historical campaign still covers the slot.
 */

/** Never create an eleventh placement — the inventory is fixed at ten. */
export const FIXED_AD_SLOT_COUNT = 10;

export type InventoryAd = {
  /** Creative image shown in place of the "Advertise" card. */
  image_url: string;
  /** Checkout framing for any-ratio / GIF creatives. */
  focus?: CreativeFocus;
  ad_name: string;
  destination_url: string;
  /** When the occupancy ends, if the source knows. */
  ends_at: string | null;
  source: "order" | "campaign";
  /**
   * True when the occupying ad is already public. A submission still in review
   * or awaiting payment is not, so its artwork must not reach a public page.
   */
  live: boolean;
};

export type InventorySlot = {
  id: number;
  name: string;
  side: "left" | "right";
  position: number;
  price_cents: number;
  status: string;
  description: string | null;
  /** True only when nothing occupies the slot right now. */
  available: boolean;
  /** The creative of the occupying ad, when one can be shown. */
  ad: InventoryAd | null;
};

function missingTable(error: any) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function missingColumn(error: any) {
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    /column .* does not exist|could not find the '.*' column/i.test(error?.message || "")
  );
}

function missingOrderTable(error: any) {
  return missingTable(error) && /ad_orders/i.test(error?.message || "");
}

function asTime(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Orders that hold a placement right now (or will start later today). */
function orderHoldsSlot(order: { status?: string | null; ends_at?: string | null }) {
  if (!order.status) return false;
  if (order.status === "rejected") return false;
  // An in-review order reserves the slot while the operator reviews it.
  if (order.status === "in_review") return true;
  if (order.status === "paused") return true;
  if (order.status === "live") return asTime(order.ends_at) > Date.now();
  return false;
}

type CampaignRow = {
  slot_id: number | string;
  status?: string | null;
  hold_expires_at?: string | null;
  end_date?: string | null;
  creative?: { image_url?: string | null; title?: string | null; destination_url?: string | null } | Array<any> | null;
  name?: string | null;
};

function campaignHoldsSlot(campaign: CampaignRow) {
  if (campaign.status === "pending_payment") {
    return asTime(campaign.hold_expires_at) > Date.now();
  }
  return ["active", "paused", "pending_review"].includes(String(campaign.status || ""));
}

/**
 * Orders that hold a placement, with the framing they were bought with.
 *
 * Migration 26 adds focus_x/focus_y/focus_zoom; during a rolling deploy the
 * columns may not exist yet, and an unframed banner is still a banner.
 */
async function orderInventory(db: ReturnType<typeof createServiceClient>) {
  const query = (columns: string) =>
    db
      .from("ad_orders")
      .select(columns)
      .in("status", ["in_review", "live", "paused"]);
  const withFocus = await query(
    "slot_id,status,ends_at,ad_name,image_url,destination_url,focus_x,focus_y,focus_zoom",
  );
  if (!withFocus.error) return withFocus;
  if (!missingColumn(withFocus.error)) return withFocus;
  return query("slot_id,status,ends_at,ad_name,image_url,destination_url");
}

export async function loadInventory(): Promise<InventorySlot[]> {
  const db = createServiceClient();
  const [slotResult, campaignResult, orderResult] = await Promise.all([
    db
      .from("ad_slots")
      .select("id,name,side,position,price_cents,status,description")
      .order("id"),
    // Historical campaigns still protect their placement from being resold.
    db
      .from("campaigns")
      .select("slot_id,status,hold_expires_at,end_date,name,creative:ad_creatives(image_url,title,destination_url)")
      .in("status", ["active", "paused", "pending_review", "pending_payment"])
      .gt("end_date", new Date().toISOString().slice(0, 10)),
    orderInventory(db),
  ]);

  if (slotResult.error) throw new Error("Unable to load inventory");
  // Let code deploy before migration 25 without breaking historical inventory.
  // Every other order-query failure is treated as unavailable, not as an open slot.
  if (orderResult.error && !missingOrderTable(orderResult.error)) {
    throw new Error("Unable to load inventory");
  }

  // A database without the creative join (very old schema) still reports the
  // slot as taken; it simply has no image to show.
  let campaigns = (campaignResult.data || []) as CampaignRow[];
  if (campaignResult.error) {
    if (!missingTable(campaignResult.error) && !missingColumn(campaignResult.error)) {
      throw new Error("Unable to load inventory");
    }
    if (!missingTable(campaignResult.error)) {
      const fallback = await db
        .from("campaigns")
        .select("slot_id,status,hold_expires_at,end_date,name")
        .in("status", ["active", "paused", "pending_review", "pending_payment"])
        .gt("end_date", new Date().toISOString().slice(0, 10));
      campaigns = (fallback.data || []) as CampaignRow[];
    }
  }

  const occupied = new Map<number, InventoryAd>();

  for (const campaign of campaigns) {
    if (!campaignHoldsSlot(campaign)) continue;
    const creative = Array.isArray(campaign.creative) ? campaign.creative[0] : campaign.creative;
    const slotId = Number(campaign.slot_id);
    if (!Number.isFinite(slotId) || occupied.has(slotId)) continue;
    occupied.set(slotId, {
      image_url: creative?.image_url || "",
      ad_name: creative?.title || campaign.name || "Reserved placement",
      destination_url: creative?.destination_url || "",
      ends_at: campaign.end_date ? `${campaign.end_date}T23:59:59.000Z` : null,
      source: "campaign",
      live: campaign.status === "active",
    });
  }

  for (const order of (orderResult.data || []) as any[]) {
    if (!orderHoldsSlot(order)) continue;
    const slotId = Number(order.slot_id);
    if (!Number.isFinite(slotId)) continue;
    const existing = occupied.get(slotId);
    // A live paid creative always wins over anything else in the same slot.
    if (existing && existing.source === "order" && order.status !== "live") continue;
    occupied.set(slotId, {
      image_url: order.image_url || "",
      focus: focusFromRow(order),
      ad_name: order.ad_name || existing?.ad_name || "Reserved placement",
      destination_url: order.destination_url || "",
      ends_at: order.ends_at || null,
      source: "order",
      live: order.status === "live" && asTime(order.ends_at) > Date.now(),
    });
  }

  return (slotResult.data || []).map((slot: any) => {
    const id = Number(slot.id);
    const ad = occupied.get(id) || null;
    return {
      ...slot,
      id,
      side: slot.side === "right" ? ("right" as const) : ("left" as const),
      available: slot.status === "available" && !ad,
      ad,
    } satisfies InventorySlot;
  });
}

export type SlotBoardRow = InventorySlot & {
  /** Operator-facing state used by the dashboard and the ad-slot board. */
  taken: boolean;
  label: "Available" | "Taken";
};

/** Adds the "Available" / "Taken" label every admin surface prints. */
export function slotBoardRows(slots: InventorySlot[]): SlotBoardRow[] {
  return slots.map((slot) => ({
    ...slot,
    taken: !slot.available,
    label: slot.available ? "Available" : "Taken",
  }));
}

export type AdRevenueSummary = {
  /** Sum of verified PayPal orders still on record, in cents. */
  verifiedCents: number;
  /** Orders counted in `verifiedCents`. */
  verifiedOrders: number;
  /** Verified money removed by an admin deletion, in cents. */
  refundedCents: number;
  refundedOrders: number;
};

/**
 * Ad revenue counted by the dashboard.
 *
 * Deleting an advertisement removes its order row, so the $99 is no longer part
 * of `verifiedCents`. The audit log keeps what was removed, and is read here so
 * the operator can also see the refunded total.
 */
export async function loadAdRevenueSummary(): Promise<AdRevenueSummary> {
  const db = createServiceClient();

  const [orders, deletions] = await Promise.all([
    db.from("ad_orders").select("amount_cents,status,payment_status"),
    db
      .from("audit_logs")
      .select("action,metadata")
      .eq("action", "ad_order_deleted")
      .limit(500),
  ]);

  const verified = ((orders.data || []) as any[]).filter(
    (order) => order.payment_status === "verified" && order.status !== "rejected",
  );

  const refunded = ((deletions.data || []) as any[]).filter(
    (row) => Number(row?.metadata?.verified_cents) > 0,
  );

  return {
    verifiedCents: verified.reduce((sum, order) => sum + Number(order.amount_cents || 0), 0),
    verifiedOrders: verified.length,
    refundedCents: refunded.reduce(
      (sum, row) => sum + Number(row?.metadata?.verified_cents || 0),
      0,
    ),
    refundedOrders: refunded.length,
  };
}
