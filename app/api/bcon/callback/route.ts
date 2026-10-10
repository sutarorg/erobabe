import { NextRequest, NextResponse } from "next/server";
import { parseBconCallback } from "@/lib/bcon/client";
import { verifyAndProcessBconPayment, confirmPayment } from "@/lib/bcon/verify";

/**
 * Bcon callback handler
 * Bcon docs example uses query params: addr, txid, value, status, external_id
 * We support both GET and POST (Bcon may POST)
 * Must be idempotent, validate against trusted DB, require confirmed status
 */

export async function GET(req: NextRequest) {
  return handleCallback(req);
}

export async function POST(req: NextRequest) {
  return handleCallback(req);
}

async function handleCallback(req: NextRequest) {
  try {
    const url = new URL(req.url);
    // Also check body if POST
    let bodyParams: any = {};
    if (req.method === "POST") {
      try {
        const text = await req.text();
        if (text) {
          // Try JSON
          try {
            bodyParams = JSON.parse(text);
          } catch {
            // Try form urlencoded
            const params = new URLSearchParams(text);
            params.forEach((v, k) => (bodyParams[k] = v));
          }
        }
      } catch {}
    }

    // Merge query + body
    const combined = new URL(req.url);
    Object.entries(bodyParams).forEach(([k, v]) => {
      if (!combined.searchParams.has(k)) combined.searchParams.set(k, String(v));
    });

    const callback = parseBconCallback(combined);

    console.log("Bcon callback received", callback);

    // Verify and process
    const result = await verifyAndProcessBconPayment(callback);

    if (!result.ok) {
      if (result.unknown) {
        // Record but return 200 to avoid retries for unknown payments (will be reviewed)
        return NextResponse.json({ status: "unknown_payment", error: result.error }, { status: 200 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (result.alreadyProcessed) {
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }

    // Check if status indicates confirmed
    const rawStatus = callback.status || (callback as any).confirmations || "";
    const isConfirmed =
      rawStatus === "confirmed" ||
      rawStatus === "2" ||
      (callback as any).status === "confirmed" ||
      // Bcon example: status param may be numeric confirmations
      (typeof rawStatus === "string" && rawStatus.toLowerCase().includes("confirm"));

    // For safety, only mark confirmed if explicitly confirmed status
    // Bcon docs: confirmed = 2 confirmations
    if (isConfirmed && result.payment) {
      const txid = callback.txid || callback.transaction_id || "";
      if (txid) {
        await confirmPayment(result.payment.id, txid);
        return NextResponse.json({ status: "confirmed", paymentId: result.payment.id }, { status: 200 });
      }
    }

    // If not yet confirmed, we recorded awaiting_confirmation
    return NextResponse.json({ status: "received", paymentId: result.payment?.id }, { status: 200 });
  } catch (e: any) {
    console.error("Bcon callback error", e);
    return NextResponse.json({ error: "Internal error", details: e.message }, { status: 500 });
  }
}
