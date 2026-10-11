import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  compareCryptoAmounts,
  getNowpaymentsPayment,
  isSuccessfulNowpaymentsStatus,
  isTerminalNowpaymentsStatus,
  mapNowpaymentsStatus,
  payCurrencyChoice,
} from "@/lib/nowpayments/client";
import { confirmNowpaymentsPayment } from "@/lib/nowpayments/verify";
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

const TERMINAL_INTERNAL = new Set(["confirmed", "failed", "expired", "refunded", "underpaid", "overpaid"]);

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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = querySchema.safeParse({ paymentId: req.nextUrl.searchParams.get("paymentId") });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const service = createServiceClient();
    const { data: payment, error } = await service
      .from("payments")
      .select("*")
      .eq("id", parsed.data.paymentId)
      .single();
    if (error) throw error;
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    // Owners and admins only — never leak another advertiser's payment.
    if (payment.advertiser_id !== user.id) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (!profile || profile.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    let current = payment as Record<string, unknown>;
    const providerPaymentId = String(current.provider_payment_id || "");
    const isNowpayments = String(current.provider || "bcon") === "nowpayments";

    // Refresh pending NOWPayments payments from the verified API, throttled
    // so polling cannot hammer the provider.
    if (isNowpayments && providerPaymentId && !TERMINAL_INTERNAL.has(String(current.status))) {
      const response = (current.provider_response as Record<string, unknown> | null) || null;
      const lastRefresh = Number(response?._refreshed_at || 0);
      if (!Number.isFinite(lastRefresh) || Date.now() - lastRefresh >= REFRESH_THROTTLE_MS) {
        const lookup = await getNowpaymentsPayment(providerPaymentId);
        if (lookup.ok) {
          const providerStatus = String(lookup.payment.providerStatus || "").toLowerCase();
          const mapped = mapNowpaymentsStatus(providerStatus);
          const stamped = { ...(response || {}), _refreshed_at: Date.now() };

          if (isSuccessfulNowpaymentsStatus(providerStatus)) {
            // Same bar as the IPN path: corroborated `finished` plus a
            // verified crypto amount, otherwise manual review.
            const received = lookup.payment.actuallyPaid ?? lookup.payment.payAmount;
            const expected = (current.expected_amount as string | null) ?? lookup.payment.payAmount;
            const verdict = compareCryptoAmounts(received, expected);
            if (verdict === "match") {
              await confirmNowpaymentsPayment(String(current.id), providerPaymentId);
              const { data: refreshed } = await service.from("payments").select("*").eq("id", current.id).single();
              if (refreshed) current = refreshed as Record<string, unknown>;
            } else if (verdict === "underpaid" || verdict === "overpaid") {
              await service
                .from("payments")
                .update({ status: verdict, provider_status: providerStatus, provider_response: stamped })
                .eq("id", current.id);
              await service.from("payment_events").insert({
                payment_id: current.id,
                event_type: "amount_mismatch",
                payload: { source: "status_refresh", verdict, received, expected },
              });
              current = { ...current, status: verdict, provider_status: providerStatus, provider_response: stamped };
            } else {
              await service
                .from("payments")
                .update({ provider_status: providerStatus, provider_response: stamped })
                .eq("id", current.id);
              current = { ...current, provider_status: providerStatus, provider_response: stamped };
            }
          } else if (mapped && !isTerminalNowpaymentsStatus(providerStatus)) {
            await service
              .from("payments")
              .update({ status: mapped, provider_status: providerStatus, provider_response: stamped })
              .eq("id", current.id);
            current = { ...current, status: mapped, provider_status: providerStatus, provider_response: stamped };
          } else if (mapped) {
            // Terminal provider state (failed / expired / refunded): persist
            // the provider truth; the IPN path applies the side effects, but
            // the status must not keep showing as pending if the IPN is late.
            await service
              .from("payments")
              .update({ status: mapped, provider_status: providerStatus, provider_response: stamped })
              .eq("id", current.id);
            current = { ...current, status: mapped, provider_status: providerStatus, provider_response: stamped };
          }
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
