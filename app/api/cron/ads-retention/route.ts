import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { releaseFinishedCreatives } from "@/lib/ads/creative-cleanup";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Daily cleanup of advertisement banners that can no longer run.
 *
 * Rejecting an ad deletes its banner immediately; this job covers the other
 * endings — a paid window that closed without anyone touching the order — and
 * sweeps up anything a failed deletion left behind. Same contract as the other
 * cron routes: `Authorization: Bearer $CRON_SECRET`, no body, no caching.
 */

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
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: process.env.CRON_SECRET ? 401 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const released = await releaseFinishedCreatives(createServiceClient(), { limit: 200 });
    if (released.some((entry) => entry.path)) revalidatePublicTag("ads");
    return NextResponse.json(
      {
        ok: true,
        checked: released.length,
        removed: released.filter((entry) => entry.path && entry.removed).length,
        failed: released.filter((entry) => entry.path && !entry.removed).length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Never log or return individual order or advertiser data.
    return NextResponse.json(
      { error: "Creative cleanup unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
