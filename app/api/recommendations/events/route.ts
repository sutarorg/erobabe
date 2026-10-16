import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, limitRequest, RequestError } from "@/lib/http/safety";
import { createServiceClient } from "@/lib/supabase/server";
import { viewerHashFromCookie } from "@/lib/recommendations/service";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const event = z.object({
  videoId: z.string().uuid(),
  type: z.enum(["impression", "card_select", "playback_start", "progress_25", "progress_50", "progress_75", "playback_complete", "playback_error", "like", "unlike"]),
  surface: z.enum(["home", "up_next", "recommended", "featured", "most_liked", "watch"]),
  position: z.number().int().min(0).max(99).nullable().optional(),
  algorithmVersion: z.string().min(1).max(40),
  correlationId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});
const payload = z.object({ events: z.array(event).min(1).max(30) }).strict();

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    await limitRequest(request, "recommendation-events", 90);
    const parsed = payload.safeParse(await boundedJson(request, 8_192));
    if (!parsed.success) return NextResponse.json({ error: "Invalid event payload" }, { status: 400 });
    let viewerHash = await viewerHashFromCookie();
    const cookieValue = (await cookies()).get("erobabe-rec-profile")?.value || "";
    const token = /^[A-Za-z0-9_-]{40,100}$/.test(cookieValue) ? cookieValue : "temp-" + Math.random().toString(36).slice(2);
    const secret = process.env.ANALYTICS_HASH_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!viewerHash && secret) {
      try {
        viewerHash = createHmac("sha256", secret).update(`recommendation-profile:${token}`).digest("hex");
      } catch { viewerHash = token; }
    }
    if (!viewerHash) viewerHash = token;
    const db = createServiceClient();
    let accepted = 0;
    for (const item of parsed.data.events) {
      const { data, error } = await db.rpc("record_recommendation_event", {
        p_viewer: viewerHash,
        p_video: item.videoId,
        p_type: item.type,
        p_surface: item.surface,
        p_position: item.position ?? null,
        p_version: item.algorithmVersion,
        p_correlation: item.correlationId,
        p_idempotency: item.idempotencyKey,
      });
      if (error) {
        // No viewer/video IDs or raw event payloads enter logs.
        console.warn("[recommendations] event-ingestion-failed");
        return NextResponse.json({ error: "Unable to record event" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
      if (data === true) accepted += 1;
    }
    return NextResponse.json({ accepted }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Unable to record event" }, { status: error instanceof RequestError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
