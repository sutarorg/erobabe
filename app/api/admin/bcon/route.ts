import { NextRequest, NextResponse } from "next/server";
import { applyBconStoreCallbacks, inspectBconSetup } from "@/lib/bcon/client";
import { getSiteUrl } from "@/lib/site";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";

/**
 * Admin-only view of the live Bcon store configuration.
 *
 * GET  — inspect per-chain callback URLs.
 * POST — push the string callback_url.{btc,bnb,eth,...} object to Bcon so
 *        merchant-platforms stops rejecting the store form.
 */
export async function GET() {
  try {
    await requireActiveAdmin();
    const report = await inspectBconSetup(getSiteUrl());
    return NextResponse.json(report);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unauthorized" }, { status: httpErrorStatus(error.message || "") });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireActiveAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "apply-callbacks");
    if (action !== "apply-callbacks") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const result = await applyBconStoreCallbacks(getSiteUrl());
    const report = await inspectBconSetup(getSiteUrl());
    return NextResponse.json({ ...result, report }, { status: result.ok ? 200 : 502 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unauthorized" }, { status: httpErrorStatus(error.message || "") });
  }
}
