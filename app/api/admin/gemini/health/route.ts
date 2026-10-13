import { NextResponse } from "next/server";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { probeGemini } from "@/lib/gemini/client";

/**
 * Admin-only Gemini connectivity check.
 *
 * GET  — reports configuration (key present? which shape? which endpoint and
 *        model will be used) without calling Google.
 * POST — sends one tiny real request and reports exactly what Google answered.
 *
 * The probe is what makes "Gemini is not generating metadata" diagnosable from
 * the admin UI: it distinguishes a missing key, a rejected key, a model the key
 * cannot use, and quota exhaustion. Key values are never returned or logged.
 */

/** One probe per admin per 30 s — it spends real quota. */
const PROBE_WINDOW_MS = 30_000;
const probeLog = new Map<string, number>();

export async function GET() {
  try {
    await requireActiveAdmin();
    const { geminiDiagnostics } = await import("@/lib/gemini/client");
    return NextResponse.json(geminiDiagnostics());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ error: message || "Unauthorized" }, { status: httpErrorStatus(message || "") });
  }
}

export async function POST() {
  try {
    const { user } = await requireActiveAdmin();

    const last = probeLog.get(user.id) || 0;
    if (Date.now() - last < PROBE_WINDOW_MS) {
      return NextResponse.json({ error: "A Gemini probe just ran — try again in a few seconds" }, { status: 429 });
    }
    probeLog.set(user.id, Date.now());

    const probe = await probeGemini();
    return NextResponse.json({ probe }, { status: probe.ok ? 200 : 502 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ error: message || "Unauthorized" }, { status: httpErrorStatus(message || "") });
  }
}
