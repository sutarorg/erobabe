import { NextRequest, NextResponse } from "next/server";
import { inspectBconSetup, probeBconCallbackEndpoint } from "@/lib/bcon/client";
import { getSiteUrl } from "@/lib/site";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";

/**
 * Admin-only view of the live Bcon store configuration.
 *
 * GET  — read the store through Bcon's documented `stores/get_store` endpoint
 *        and report which per-chain callback fields are empty or wrong.
 * POST — probe this deployment's callback URL (the only callback check that
 *        can be verified from the application side).
 *
 * Bcon publishes no store-write endpoint, so nothing here modifies the store:
 * callback URLs are entered by the operator in the Bcon dashboard.
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
    const action = String(body?.action || "probe-callback");
    if (action !== "probe-callback") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const probe = await probeBconCallbackEndpoint(getSiteUrl());
    const report = await inspectBconSetup(getSiteUrl());
    return NextResponse.json({ probe, report }, { status: probe.ok ? 200 : 502 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unauthorized" }, { status: httpErrorStatus(error.message || "") });
  }
}
