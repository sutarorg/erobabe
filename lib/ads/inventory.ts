import { createServiceClient } from "@/lib/supabase/server";
export async function loadInventory() {
  const db = createServiceClient();
  const [{ data: slots, error }, { data: campaigns, error: campaignError }] =
    await Promise.all([
      db
        .from("ad_slots")
        .select("id,name,side,position,price_cents,status,description")
        .order("id"),
      db
        .from("campaigns")
        .select("slot_id,status,hold_expires_at")
        .in("status", ["active", "paused", "pending_review", "pending_payment"])
        .gt("end_date", new Date().toISOString().slice(0, 10)),
    ]);
  if (error || campaignError) throw new Error("Unable to load inventory");
  const occupied = new Set(
    (campaigns || [])
      .filter(
        (c: any) =>
          c.status !== "pending_payment" ||
          new Date(c.hold_expires_at).getTime() > Date.now(),
      )
      .map((c: any) => c.slot_id),
  );
  return (slots || []).map((s: any) => ({
    ...s,
    available: s.status === "available" && !occupied.has(s.id),
  }));
}
