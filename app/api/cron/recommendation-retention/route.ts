import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function authorized(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const given = Buffer.from(supplied);
  const expected = Buffer.from(secret);
  return Boolean(secret && given.length === expected.length && timingSafeEqual(given, expected));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: process.env.CRON_SECRET ? 401 : 503, headers: { "Cache-Control": "no-store" } });
  try {
    const { error } = await createServiceClient().rpc("prune_recommendation_data");
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Never log or return individual profile/event data.
    return NextResponse.json({ error: "Retention cleanup unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
