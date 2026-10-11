import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "advertiser" || profile.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const service = createServiceClient();
    const today = new Date().toISOString().split("T")[0];
    const [{ data: slots, error: slotsError }, { data: occupied, error: occupiedError }] = await Promise.all([
      service.from("ad_slots").select("id, name, side, position, price_cents, status, description").order("id"),
      service
        .from("campaigns")
        .select("slot_id")
        .in("status", ["active", "pending_review", "pending_payment"])
        .gte("end_date", today),
    ]);
    if (slotsError) throw slotsError;
    if (occupiedError) throw occupiedError;

    const occupiedSlotIds = new Set((occupied || []).map((campaign: any) => Number(campaign.slot_id)));
    return NextResponse.json({
      slots: (slots || []).map((slot: any) => ({
        ...slot,
        available: slot.status === "available" && !occupiedSlotIds.has(Number(slot.id)),
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unable to load slot availability" }, { status: 500 });
  }
}
