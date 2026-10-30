import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, limitRequest, RequestError } from "@/lib/http/safety";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Viewable impressions and clicks for the guest PayPal placements.
 *
 * Legacy campaigns keep `/api/track/impression` and `/api/track/click`
 * (`lib/ads/track.ts`); a guest order has no campaign row, so its measurement
 * is keyed on the order id instead. The database function checks that the order
 * is live, paid and actually booked into the slot it claims, then deduplicates
 * one event per visitor per hour.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

const schema = z
  .object({
    eventId: z.string().uuid(),
    orderId: z.string().uuid(),
    slotId: z.number().int().min(1).max(10),
    kind: z.enum(["impression", "click"]),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await boundedJson(req, 1024));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400, headers });
    }

    // The daily hash doubles as the per-visitor rate-limit key and the
    // de-duplication key, exactly like the legacy campaign events.
    const visitor = await limitRequest(req, "ad-order-events", 60);
    const event = parsed.data;

    const { data, error } = await createServiceClient().rpc("record_ad_order_event", {
      p_id: event.eventId,
      p_order: event.orderId,
      p_slot: event.slotId,
      p_kind: event.kind,
      p_visitor: visitor,
    });
    if (error) throw error;

    return NextResponse.json({ recorded: data === true }, { status: 202, headers });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    return NextResponse.json({ error: "Event unavailable" }, { status: 503, headers });
  }
}
