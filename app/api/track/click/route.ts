import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { slotId, creativeTitle } = await req.json();
    // Record as video_event with type click for now, or create ad_events table
    // For simplicity, we log to audit_logs and could have ad_events
    const service = createServiceClient();
    await service.from("audit_logs").insert({
      action: "ad_click",
      target_type: "ad_slot",
      target_id: String(slotId),
      level: "info",
      metadata: { creativeTitle, timestamp: new Date().toISOString() },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
