import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  getNowpaymentsPayment,
  payCurrencyChoice,
} from "@/lib/nowpayments/client";
import {
  confirmNowpaymentsPayment,
  verifyAndProcessNowpaymentsIpn,
} from "@/lib/nowpayments/verify";
import { z } from "zod";

/**
 * Authenticated payment-status endpoint for the advertiser checkout.
 *
 * Reads the persisted payment first and, while it is still pending, refreshes
 * the provider state from the verified NOWPayments API (throttled). The
 * browser can poll this while a payment is pending, but it can never mark a
 * payment successful itself — fulfillment only happens here, on the server,
 * after the same verification the IPN path applies.
 */

const querySchema = z.object({
  paymentId: z.string().uuid(),
});

/** Minimum gap between verified provider refreshes for one payment. */
const REFRESH_THROTTLE_MS = 30 * 1000;

const TERMINAL_INTERNAL = new Set([
  "confirmed",
  "failed",
  "expired",
  "refunded",
  "underpaid",
  "overpaid",
]);

function displayState(payment: Record<string, unknown>): string {
  const status = String(payment.status || "pending");
  switch (status) {
    case "confirmed":
      return "confirmed";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "underpaid":
    case "overpaid":
      return "manual_review";
    case "refunded":
      return "refunded";
    case "partially_confirmed":
      return "confirming";
    case "awaiting_confirmation":
    case "pending":
    default:
      return "awaiting_payment";
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = querySchema.safeParse({
      paymentId: req.nextUrl.searchParams.get("paymentId"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const service = createServiceClient();
    const { data: payment, error } = await service
      .from("payments")
      .select("*")
      .eq("id", parsed.data.paymentId)
      .single();
    if (error) throw error;
    if (!payment)
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();
    if (
      !profile ||
      profile.status !== "active" ||
      (payment.advertiser_id !== user.id && profile.role !== "admin")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let current = payment as Record<string, unknown>;
    const providerPaymentId = String(current.provider_payment_id || "");
    const isNowpayments = String(current.provider || "bcon") === "nowpayments";

    // Refresh pending NOWPayments payments from the verified API, throttled
    // so polling cannot hammer the provider.
    if (
      isNowpayments &&
      providerPaymentId &&
      !["refunded", "failed", "expired"].includes(String(current.status))
    ) {
      const response =
        (current.provider_response as Record<string, unknown> | null) || null;
      const lastRefresh = new Date(
        String(current.updated_at || current.created_at),
      ).getTime();
      if (
        !Number.isFinite(lastRefresh) ||
        Date.now() - lastRefresh >= REFRESH_THROTTLE_MS
      ) {
        const lookup = await getNowpaymentsPayment(providerPaymentId);
        if (lookup.ok) {
          const result = await verifyAndProcessNowpaymentsIpn(
            lookup.payment.raw,
          );
          if (
            result.ok &&
            result.verified &&
            result.status === "confirmed" &&
            result.payment
          ) {
            await confirmNowpaymentsPayment(
              result.payment.id,
              providerPaymentId,
            );
          }
          const { data: refreshed, error: refreshError } = await service
            .from("payments")
            .select("*")
            .eq("id", current.id)
            .single();
          if (refreshError) throw refreshError;
          if (refreshed) current = refreshed;
        }
        // A failed refresh never fails the status read — the persisted state
        // below is still the honest answer.
      }
    }

    const choice = payCurrencyChoice(String(current.pay_currency || ""));
    return NextResponse.json({
      paymentId: current.id,
      state: displayState(current),
      status: current.status,
      provider: current.provider || "bcon",
      providerStatus: current.provider_status || null,
      address: current.payment_address || null,
      amount: current.expected_amount || null,
      payCurrency: current.pay_currency || null,
      paymentCurrency: current.payment_currency || null,
      network: choice?.network || current.chain || null,
      chain: current.chain || null,
      priceCents: current.amount_cents,
      invoiceNumber: current.invoice_number,
      expiresAt: current.expires_at,
      confirmedAt: current.confirmed_at,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("nowpayments/status error", message);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
