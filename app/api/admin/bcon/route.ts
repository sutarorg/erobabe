import { NextResponse } from "next/server";
import { inspectBconSetup } from "@/lib/bcon/client";
import { getSiteUrl } from "@/lib/site";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";

/**
 * Admin-only view of the live Bcon store configuration.
 *
 * Returns the callback URL registered for every chain on the store so the admin
 * can see exactly which `callback_url.<chain>` fields Bcon's dashboard is still
 * rejecting as missing.
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
