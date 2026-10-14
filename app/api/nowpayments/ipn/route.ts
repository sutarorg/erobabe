import { boundedText, RequestError } from "@/lib/http/safety";
import { NextRequest, NextResponse } from "next/server";
import {
  safeErrorMessage,
  verifyNowpaymentsSignature,
} from "@/lib/nowpayments/client";
import {
  confirmNowpaymentsPayment,
  verifyAndProcessNowpaymentsIpn,
} from "@/lib/nowpayments/verify";

/**
 * NOWPayments IPN handler — public by design (NOWPayments calls it
 * server-to-server, so it must work without a logged-in user session).
 *
 * Per https://nowpayments.io/help/what-is/what-is-ipn, every IPN is a JSON
 * POST carrying an `x-nowpayments-sig` HMAC-SHA512 signature. Anything that
 * is unsigned, malformed, or fails verification is rejected and the payment
 * stays unconfirmed. A `payment_status` of `finished` in the body alone
 * proves nothing — the payment is corroborated against NOWPayments' own API
 * before fulfillment.
 *
 * NOWPayments retries IPNs that do not answer 200, so:
 *  - invalid/unknown notifications answer 200 (`unknown_payment`) or 400/401
 *    once recorded, without touching any payment;
 *  - transient failures (provider unreachable, database error) answer 503 so
 *    NOWPayments delivers the notification again.
 */

const MAX_IPN_BYTES = 64 * 1024;

/** Lets NOWPayments (and an operator) verify the URL is reachable. */
export async function GET() {
  return NextResponse.json(
    { status: "ok", message: "NOWPayments IPN endpoint is reachable" },
    { status: 200 },
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await boundedText(req, MAX_IPN_BYTES);
    if (!rawBody) {
      return NextResponse.json({ error: "Empty IPN body" }, { status: 400 });
    }
    if (rawBody.length > MAX_IPN_BYTES) {
      return NextResponse.json(
        { error: "IPN body too large" },
        { status: 413 },
      );
    }

    // The signature is verified BEFORE anything else: no lookup, no logging
    // of the payload, no state change for an untrusted notification.
    const verification = verifyNowpaymentsSignature(
      rawBody,
      req.headers.get("x-nowpayments-sig"),
    );
    if (!verification.ok) {
      const missingSecret =
        verification.error === "IPN secret is not configured";
      console.error(`NOWPayments IPN rejected: ${verification.error}`);
      return NextResponse.json(
        {
          status: "rejected",
          error: missingSecret
            ? "IPN is not configured on this deployment"
            : "Invalid IPN signature",
        },
        { status: missingSecret ? 503 : 401 },
      );
    }

    console.log("NOWPayments IPN received", {
      has_payment_id: rawBody.includes("payment_id"),
    });

    const result = await verifyAndProcessNowpaymentsIpn(verification.payload);

    if (!result.ok) {
      if (result.unknown) {
        // Never retried for strangers, but recorded for admin review.
        return NextResponse.json(
          { status: "unknown_payment" },
          { status: 200 },
        );
      }
      if (result.retryable) {
        // NOWPayments (or our network) could not be reached — ask for a retry
        // later instead of recording a guess.
        return NextResponse.json(
          { status: "retry_later", error: result.error },
          { status: 503 },
        );
      }
      if (result.recorded) {
        // Processed and recorded (e.g. an under/over paid amount): no retry
        // can change the outcome, so answer 200 and leave it for human review.
        return NextResponse.json(
          {
            status: result.status || "recorded",
            paymentId: result.payment?.id,
          },
          { status: 200 },
        );
      }
      // Invalid, unverifiable or mismatched notification: the payment stays
      // unconfirmed.
      return NextResponse.json(
        { status: result.status || "rejected", error: result.error },
        { status: 400 },
      );
    }

    if (result.alreadyProcessed) {
      return NextResponse.json(
        { status: "already_processed" },
        { status: 200 },
      );
    }

    if (
      result.verified &&
      result.status === "confirmed" &&
      result.payment &&
      result.providerPayment
    ) {
      await confirmNowpaymentsPayment(
        result.payment.id,
        result.providerPayment.paymentId,
      );
      return NextResponse.json(
        { status: "confirmed", paymentId: result.payment.id },
        { status: 200 },
      );
    }

    // Intermediate or provider-terminal outcomes already applied by the
    // verifier (failed / expired / refunded / underpaid).
    return NextResponse.json(
      { status: result.status || "received", paymentId: result.payment?.id },
      { status: 200 },
    );
  } catch (error: unknown) {
    if (error instanceof RequestError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    // Log a bounded, credential-free message only — never the full error
    // object or the request, which could carry provider payloads.
    console.error(`NOWPayments IPN error: ${safeErrorMessage(error)}`);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
