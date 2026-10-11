import { NextRequest, NextResponse } from "next/server";
import { inspectNowpaymentsSetup, probeNowpaymentsIpnEndpoint } from "@/lib/nowpayments/client";
import { getSiteUrl } from "@/lib/site";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";

/**
 * Admin-only view of the NOWPayments integration health.
 *
 * GET  — configuration + a safe authenticated API connectivity check
 *        (`GET /v1/status` — creates no payment).
 * POST — probe this deployment's IPN URL (the only callback check that can
 *        be verified from the application side).
 *
 * API keys and the IPN secret are reported only as present/missing — values
 * are never returned.
 */
export async function GET() {
  try {
    await requireActiveAdmin();
    const report = await inspectNowpaymentsSetup(getSiteUrl());
    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ error: message || "Unauthorized" }, { status: httpErrorStatus(message || "") });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireActiveAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "probe-ipn");
    if (action !== "probe-ipn") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const probe = await probeNowpaymentsIpnEndpoint(getSiteUrl());
    const report = await inspectNowpaymentsSetup(getSiteUrl());
    return NextResponse.json({ probe, report }, { status: probe.ok ? 200 : 502 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ error: message || "Unauthorized" }, { status: httpErrorStatus(message || "") });
  }
}
