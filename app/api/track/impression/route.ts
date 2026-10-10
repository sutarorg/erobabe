import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { slotId } = await req.json();
    const service = createServiceClient();
    // In production, you'd have ad_impressions table with deduplication
    await service.from("audit_logs").insert({
      action: "ad_impression",
      target_type: "ad_slot",
      target_id: String(slotId),
      level: "info",
      metadata: { timestamp: new Date().toISOString() },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
