import { NextRequest, NextResponse } from "next/server";
import { parseBconCallback, type BconCallbackQuery } from "@/lib/bcon/client";
import { confirmPayment, verifyAndProcessBconPayment } from "@/lib/bcon/verify";

/**
 * Bcon callback handler — public by design (Bcon calls it server-to-server).
 *
 * Verified behaviour from https://bcon.global/integrations/api/:
 *  - Bcon calls the configured URL with query parameters:
 *    `status` (0 = unconfirmed, 1 = partially confirmed, 2 = confirmed),
 *    `addr`, `value` (satoshis for BTC), `txid`, `external_id` (+ `memo` on BNB).
 *  - "A callback succeeds when the server returns 200 HTTP status", so
 *    anything that is not processed on purpose answers with a non-200 status
 *    and Bcon retries.
 *  - There is no signature. Every value below is untrusted input; nothing is
 *    marked paid unless `verifyAndProcessBconPayment` corroborates it against
 *    our database *and* Bcon's transaction API.
 *
 * GET, POST and HEAD are all accepted (Bcon documents GET, some proxies
 * re-send as POST) and a parameter-less probe answers 200 without touching any
 * payment record.
 */

export async function GET(req: NextRequest) {
  return handleCallback(req);
}

export async function POST(req: NextRequest) {
  return handleCallback(req);
}

// Lets Bcon (and an operator) verify that the configured callback URL is
// reachable without attempting to process a payment.
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

/** Reads body parameters for POST callbacks (JSON or form-encoded). */
function readBodyParams(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!text) return params;
  try {
    const json = JSON.parse(text);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      for (const [key, value] of Object.entries(json)) {
        if (value === null || value === undefined) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          params[key] = String(value);
        }
      }
      return params;
    }
  } catch {
    // Not JSON — fall through to form encoding.
  }
  new URLSearchParams(text).forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

function mergeCallbackParams(url: URL, bodyParams: Record<string, string>): URL {
  const combined = new URL(url.toString());
  for (const [key, value] of Object.entries(bodyParams)) {
    if (!combined.searchParams.has(key)) combined.searchParams.set(key, value);
  }
  return combined;
}

/**
 * Bounded, credential-free error text for server logs.
 * Connection strings and key material must never reach the log sink.
 */
export function safeErrorMessage(error: any): string {
  const raw = typeof error?.message === "string" ? error.message : String(error?.name || "unknown error");
  return raw
    .replace(/\/\/[^@\s/]+@/g, "//<redacted>@")
    .replace(/((?:api[_-]?key|apikey|secret|token|password|pwd|bearer)\s*[:=]\s*)[^\s,;)]+/gi, "$1<redacted>")
    .replace(/[?&](secret|key|token|apikey)=[^\s&]+/gi, "$1=<redacted>")
    .slice(0, 200);
}

/** True when the request carries no payment identifiers at all (a probe). */
function isProbe(callback: BconCallbackQuery): boolean {
  return !(
    callback.external_id ||
    callback.addr ||
    callback.address ||
    callback.txid ||
    callback.transaction_id ||
    callback.memo
  );
}

async function handleCallback(req: NextRequest) {
  try {
    const url = new URL(req.url);
    let bodyParams: Record<string, string> = {};
    if (req.method === "POST") {
      bodyParams = readBodyParams(await req.text().catch(() => ""));
    }

    const callback = parseBconCallback(mergeCallbackParams(url, bodyParams));

    // Store setup screens and uptime monitors may probe the URL without a
    // transaction payload. Answer successfully and touch nothing.
    if (isProbe(callback)) {
      return NextResponse.json({ status: "ok", message: "Bcon callback endpoint is reachable" }, { status: 200 });
    }

    // Concise, secret-free operational log.
    console.log("Bcon callback received", {
      external_id: callback.external_id ? "present" : "absent",
      status: callback.status ?? null,
      has_address: Boolean(callback.addr || callback.address || callback.memo),
      has_transaction: Boolean(callback.txid || callback.transaction_id),
    });

    const result = await verifyAndProcessBconPayment(callback);

    if (!result.ok) {
      if (result.unknown) {
        // Never retried for strangers, but recorded for admin review.
        return NextResponse.json({ status: "unknown_payment" }, { status: 200 });
      }
      if (result.retryable) {
        // Bcon could not be reached — ask for a retry later instead of
        // recording a guess.
        return NextResponse.json({ status: "retry_later", error: result.error }, { status: 503 });
      }
      if (result.recorded) {
        // Processed and recorded (e.g. an under/over payment): no retry can
        // change the outcome, so answer 200 and leave it for human review.
        return NextResponse.json({ status: result.status || "recorded", paymentId: result.payment?.id }, { status: 200 });
      }
      // Invalid, unverifiable or mismatched notification: the payment stays
      // unconfirmed. `result.status` may already have recorded under/over payment.
      return NextResponse.json({ status: result.status || "rejected", error: result.error }, { status: 400 });
    }

    if (result.alreadyProcessed) {
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }

    if (result.verified && result.status === "confirmed" && result.payment) {
      const txid = callback.txid || callback.transaction_id || result.payment.transaction_id || "";
      await confirmPayment(result.payment.id, txid);
      return NextResponse.json({ status: "confirmed", paymentId: result.payment.id }, { status: 200 });
    }

    // Unconfirmed / partially confirmed: recorded, not paid.
    return NextResponse.json({ status: result.status || "received", paymentId: result.payment?.id }, { status: 200 });
  } catch (error: any) {
    // Log a bounded, credential-free message only — never the full error object
    // or the request, which could carry connection strings or provider payloads.
    console.error(`Bcon callback error: ${safeErrorMessage(error)}`);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
