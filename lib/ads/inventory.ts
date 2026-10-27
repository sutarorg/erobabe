import { createServiceClient } from "@/lib/supabase/server";

export type InventorySlot = {
  id: number;
  name: string;
  side: "left" | "right";
  position: number;
  price_cents: number;
  status: string;
  description: string | null;
  available: boolean;
};

function missingOrderTable(error: any) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /ad_orders.*(does not exist|could not find)/i.test(error?.message || "")
  );
}

export async function loadInventory(): Promise<InventorySlot[]> {
  const db = createServiceClient();
  const [slotResult, campaignResult, orderResult] = await Promise.all([
    db
      .from("ad_slots")
      .select("id,name,side,position,price_cents,status,description")
      .order("id"),
    db
      .from("campaigns")
      .select("slot_id,status,hold_expires_at")
      .in("status", ["active", "paused", "pending_review", "pending_payment"])
      .gt("end_date", new Date().toISOString().slice(0, 10)),
    db.from("ad_orders").select("slot_id,status,ends_at").in("status", ["in_review", "live", "paused"]),
  ]);

  if (slotResult.error || campaignResult.error) throw new Error("Unable to load inventory");
  // Let code deploy before migration 25 without breaking historical inventory.
  // Every other order-query failure is treated as unavailable, not as an open slot.
  if (orderResult.error && !missingOrderTable(orderResult.error)) {
    throw new Error("Unable to load inventory");
  }

  const occupied = new Set<number>(
    (campaignResult.data || [])
      .filter(
        (campaign: any) =>
          campaign.status !== "pending_payment" ||
          new Date(campaign.hold_expires_at).getTime() > Date.now(),
      )
      .map((campaign: any) => Number(campaign.slot_id)),
  );

  for (const order of orderResult.data || []) {
    if (order.status !== "live" || new Date(order.ends_at).getTime() > Date.now()) {
      occupied.add(Number(order.slot_id));
    }
  }

  return (slotResult.data || []).map((slot: any) => ({
    ...slot,
    side: slot.side === "right" ? "right" : "left",
    available: slot.status === "available" && !occupied.has(Number(slot.id)),
  }));
}
