import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { boundedJson, limitRequest, RequestError } from "@/lib/http/safety";
const schema = z
  .object({
    eventId: z.string().uuid(),
    campaignId: z.string().uuid(),
    creativeId: z.string().uuid(),
    slotId: z.number().int().min(1).max(10),
  })
  .strict();
export async function track(req: Request, kind: "impression" | "click") {
  try {
    const parsed = schema.safeParse(await boundedJson(req, 1024));
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    const hash = await limitRequest(req, "ad-events", 60);
    const e = parsed.data;
    const { data, error } = await createServiceClient().rpc("record_ad_event", {
      p_id: e.eventId,
      p_campaign: e.campaignId,
      p_slot: e.slotId,
      p_creative: e.creativeId,
      p_kind: kind,
      p_visitor: hash,
    });
    if (error) throw error;
    return NextResponse.json({ recorded: data === true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof RequestError ? error.message : "Event unavailable",
      },
      { status: error instanceof RequestError ? error.status : 503 },
    );
  }
}
