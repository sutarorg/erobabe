import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, limitRequest, RequestError } from "@/lib/http/safety";
import { createServiceClient } from "@/lib/supabase/server";
import { viewerHashFromCookie } from "@/lib/recommendations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({
  videoId: z.string().uuid(),
  action: z.enum(["interested", "not_interested", "show_less", "less_category"]),
}).strict();

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    await limitRequest(request, "recommendation-feedback", 30);
    const parsed = input.safeParse(await boundedJson(request, 1_024));
    if (!parsed.success) return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
    const viewerHash = await viewerHashFromCookie();
    if (!viewerHash) return NextResponse.json({ error: "Enable personalization to save feedback" }, { status: 409 });
    const db = createServiceClient();
    const { data: preference, error: preferenceError } = await db.from("recommendation_preferences")
      .select("viewer_hash").eq("viewer_hash", viewerHash).eq("personalization_enabled", true)
      .gt("consent_expires_at", new Date().toISOString()).maybeSingle();
    if (preferenceError || !preference) return NextResponse.json({ error: "Enable personalization to save feedback" }, { status: 409 });
    const { error } = parsed.data.action === "less_category"
      ? await db.rpc("suppress_recommendation_category", { p_viewer: viewerHash, p_video: parsed.data.videoId })
      : await db.rpc("set_recommendation_feedback", { p_viewer: viewerHash, p_video: parsed.data.videoId, p_feedback: parsed.data.action });
    if (error) return NextResponse.json({ error: error.message === "Video unavailable" ? "Video unavailable" : "Unable to save feedback" }, { status: error.message === "Video unavailable" ? 404 : 503 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Unable to save feedback" }, { status: error instanceof RequestError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
