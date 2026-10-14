import { createServiceClient } from "@/lib/supabase/server";
import {
  compareCryptoAmounts,
  getNowpaymentsPayment,
  isSuccessfulNowpaymentsStatus,
  isTerminalNowpaymentsStatus,
  mapNowpaymentsStatus,
  normalizeNowpaymentsPayload,
  type NowpaymentsPayment,
} from "@/lib/nowpayments/client";

/**
 * NOWPayments IPN verification and fulfillment.
 *
 * An IPN is an untrusted HTTP request until its `x-nowpayments-sig` signature
 * has been verified (see `verifyNowpaymentsSignature` — the route rejects
 * anything unsigned before this module ever runs). Even a correctly signed
 * IPN is then checked against:
 *   1. our own `payments` row (provider payment id, order/invoice reference,
 *      receiving address, expected crypto amount, asset), and
 *   2. NOWPayments' server-side payment record
 *      (`GET /v1/payment/{payment_id}`) before a `finished` payment may ever
 *      be marked paid.
 *
 * Nothing in this module invents a confirmation: if a value cannot be
 * verified the payment stays unconfirmed and the mismatch is recorded for
 * review.
 */

/** Fields NOWPayments documents on an IPN — everything else is dropped before storage. */
const IPN_FIELD_WHITELIST = [
  "payment_id",
  "payment_status",
  "pay_address",
  "price_amount",
  "price_currency",
  "pay_amount",
  "actually_paid",
  "pay_currency",
  "order_id",
  "order_description",
  "purchase_id",
  "outcome_amount",
  "outcome_currency",
  "network",
  "created_at",
  "updated_at",
] as const;

const MAX_FIELD_LENGTH = 200;

/** IPN payload safe to persist or log (bounded, no secrets). */
export function redactedIpnPayload(payload: unknown): Record<string, string> {
  const safe: Record<string, string> = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return safe;
  const data = payload as Record<string, unknown>;
  for (const key of IPN_FIELD_WHITELIST) {
    const value = data[key];
    if (value === null || value === undefined) continue;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    )
      continue;
    const text = String(value);
    safe[key] =
      text.length > MAX_FIELD_LENGTH
        ? `${text.slice(0, MAX_FIELD_LENGTH)}…`
        : text;
  }
  return safe;
}

export interface NowpaymentsIpnResult {
  ok: boolean;
  payment?: Record<string, unknown> & { id: string };
  /** Internal status after processing. */
  status?: string;
  /** Provider status as reported by the IPN. */
  providerStatus?: string;
  /** True when a repeated notification for an already settled payment arrived. */
  alreadyProcessed?: boolean;
  /** True when no payment in our database matches the notification. */
  unknown?: boolean;
  /** True when NOWPayments' own API independently corroborated the payment. */
  verified?: boolean;
  /**
   * True when the notification was fully processed and the outcome recorded,
   * so there is nothing a retry could add (e.g. an underpaid amount).
   */
  recorded?: boolean;
  /** True when NOWPayments (or the network) failed transiently and the IPN should be retried. */
  retryable?: boolean;
  providerPayment?: NowpaymentsPayment;
  error?: string;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function recordPaymentEvent(
  supabase: ServiceClient,
  paymentId: string,
  eventType: string,
  payload: unknown,
) {
  const { error } = await supabase.from("payment_events").insert({
    payment_id: paymentId,
    event_type: eventType,
    payload,
  });
  if (error)
    console.error(
      `NOWPayments IPN: could not record ${eventType} event for payment ${paymentId}: ${error.message}`,
    );
}

async function recordAudit(
  supabase: ServiceClient,
  action: string,
  level: "info" | "warning",
  metadata: Record<string, unknown>,
  paymentId?: string,
) {
  const { error } = await supabase.from("audit_logs").insert({
    action,
    target_type: "payment",
    ...(paymentId ? { target_id: paymentId } : {}),
    level,
    metadata,
  });
  if (error)
    console.error(
      `NOWPayments IPN: could not write audit log ${action}: ${error.message}`,
    );
}

/** Terminal internal states that a stale intermediate IPN must never overwrite. */
function isTerminalInternalStatus(status: string | null | undefined): boolean {
  return ["confirmed", "failed", "expired", "refunded"].includes(
    String(status || ""),
  );
}

/**
 * Verifies a signed NOWPayments IPN against trusted records and applies it.
 * Idempotent — a repeated IPN never confirms twice and never duplicates a
 * business action (invoice payment, campaign activation).
 */
export async function verifyAndProcessNowpaymentsIpn(
  payload: unknown,
): Promise<NowpaymentsIpnResult> {
  const supabase = createServiceClient();
  const safeIpn = redactedIpnPayload(payload);
  const ipn = normalizeNowpaymentsPayload(payload);

  if (!ipn) {
    return { ok: false, error: "IPN is missing a payment_id" };
  }

  const providerStatus = String(ipn.providerStatus || "")
    .trim()
    .toLowerCase();
  const internalStatus = mapNowpaymentsStatus(providerStatus);
  if (!internalStatus) {
    await recordAudit(supabase, "nowpayments_ipn_unknown_status", "warning", {
      ipn: safeIpn,
      provider_status: providerStatus || null,
    });
    return {
      ok: false,
      error: `Unknown NOWPayments status: ${providerStatus || "(empty)"}`,
    };
  }

  // Correlate by provider payment id first; fall back to the order/invoice
  // reference so a mis-stored id cannot silently attach to the wrong payment.
  let payment: (Record<string, unknown> & { id: string }) | null = null;
  const { data: byProviderId, error: lookupError } = await supabase
    .from("payments")
    .select("*")
    .eq("provider_payment_id", ipn.paymentId)
    .limit(1);
  if (lookupError) throw lookupError;
  payment =
    (byProviderId?.[0] as
      | (Record<string, unknown> & { id: string })
      | undefined) ?? null;

  if (!payment && ipn.orderId) {
    const { data: byOrder, error: orderLookupError } = await supabase
      .from("payments")
      .select("*")
      .eq("invoice_number", ipn.orderId)
      .limit(1);
    if (orderLookupError) throw orderLookupError;
    payment =
      (byOrder?.[0] as
        | (Record<string, unknown> & { id: string })
        | undefined) ?? null;
  }

  if (!payment) {
    await recordAudit(supabase, "nowpayments_ipn_unknown_payment", "warning", {
      ipn: safeIpn,
    });
    return { ok: false, error: "Payment not found", unknown: true };
  }

  // A notification must reference this payment's own order/invoice id.
  // Never accept an update that belongs to another advertiser or campaign.
  if (
    ipn.orderId &&
    payment.invoice_number &&
    String(ipn.orderId) !== String(payment.invoice_number)
  ) {
    await recordPaymentEvent(supabase, payment.id, "verification_failed", {
      reason: "order_id_mismatch",
      ipn: safeIpn,
      expected_order_id: String(payment.invoice_number),
    });
    await recordAudit(
      supabase,
      "nowpayments_ipn_order_mismatch",
      "warning",
      { ipn: safeIpn },
      payment.id,
    );
    return {
      ok: false,
      error: "IPN order reference does not match the payment",
    };
  }

  // The pay currency/asset must be the one this payment was created for —
  // never silently accept a different token.
  if (
    ipn.payCurrency &&
    payment.pay_currency &&
    String(ipn.payCurrency).toLowerCase() !==
      String(payment.pay_currency).toLowerCase()
  ) {
    await recordPaymentEvent(supabase, payment.id, "verification_failed", {
      reason: "currency_mismatch",
      ipn: safeIpn,
      expected_pay_currency: String(payment.pay_currency),
    });
    await recordAudit(
      supabase,
      "nowpayments_ipn_currency_mismatch",
      "warning",
      { ipn: safeIpn, expected_pay_currency: String(payment.pay_currency) },
      payment.id,
    );
    return { ok: false, error: "IPN pay currency does not match the payment" };
  }

  const currentStatus = String(payment.status || "");
  const currentProviderStatus = String(
    (payment.provider_status as string) || "",
  ).toLowerCase();

  // Idempotency: a settled payment stays settled. The single exception is a
  // refund arriving after completion, which moves the payment to `refunded`
  // (handled below) instead of being dropped.
  if (
    isTerminalInternalStatus(currentStatus) &&
    !(currentStatus === "confirmed" && providerStatus === "refunded")
  ) {
    // A stale intermediate notification must never overwrite a terminal state.
    await recordPaymentEvent(supabase, payment.id, "ipn_repeated", {
      ...safeIpn,
      stored_status: currentStatus,
      stored_provider_status: currentProviderStatus || null,
      already_settled: true,
    });
    return {
      ok: true,
      alreadyProcessed: true,
      payment,
      status: currentStatus,
      providerStatus,
      verified: false,
    };
  }

  // Duplicate guard for repeated final notifications: when the stored
  // provider status already equals the incoming terminal status and the
  // mapped outcome was already applied, record only a lightweight repeat
  // event instead of re-applying side effects.
  if (
    isTerminalNowpaymentsStatus(providerStatus) &&
    currentProviderStatus === providerStatus &&
    currentStatus === internalStatus
  ) {
    await recordPaymentEvent(supabase, payment.id, "ipn_repeated", {
      ...safeIpn,
      stored_status: currentStatus,
      duplicate_terminal: true,
    });
    return {
      ok: true,
      alreadyProcessed: true,
      payment,
      status: currentStatus,
      providerStatus,
      verified: false,
    };
  }

  await recordPaymentEvent(supabase, payment.id, "ipn_received", {
    ...safeIpn,
    mapped_status: internalStatus,
  });

  // Intermediate statuses (waiting / confirming / confirmed / sending) are
  // recorded but never paid. `confirmed` here is the provider's intermediate
  // state — fulfillment requires `finished` plus API corroboration.
  if (!isTerminalNowpaymentsStatus(providerStatus)) {
    const updates: Record<string, unknown> = {
      provider_status: providerStatus,
      provider_response: { ipn: safeIpn, provider_status: providerStatus },
    };
    if (ipn.payAddress && !payment.payment_address)
      updates.payment_address = ipn.payAddress;
    // Only move forward within non-terminal states; a stale `waiting` after
    // `confirming` updates the provider trail, not the internal status.
    const rank = (status: string) =>
      ["pending", "awaiting_confirmation", "partially_confirmed"].indexOf(
        status,
      );
    if (rank(internalStatus) >= rank(currentStatus))
      updates.status = internalStatus;

    const { error: updateError } = await supabase
      .from("payments")
      .update(updates)
      .eq("id", payment.id)
      .in("status", [
        "pending",
        "awaiting_confirmation",
        "partially_confirmed",
      ]);
    if (updateError) throw updateError;
    return {
      ok: true,
      payment: { ...payment, ...updates },
      status: String(updates.status || currentStatus),
      providerStatus,
      verified: false,
      providerPayment: undefined,
    };
  }

  // From here on the IPN claims a terminal state. Corroborate against
  // NOWPayments' own record before applying it.
  const lookup = await getNowpaymentsPayment(ipn.paymentId);
  if (!lookup.ok) {
    if (lookup.reason === "api_error") {
      await recordPaymentEvent(supabase, payment.id, "verification_pending", {
        reason: lookup.message,
        provider_payment_id: ipn.paymentId,
        claimed_status: providerStatus,
      });
      return {
        ok: false,
        retryable: true,
        error: lookup.message,
        verified: false,
        providerStatus,
      };
    }
    await recordPaymentEvent(supabase, payment.id, "verification_failed", {
      reason: "payment_not_found_at_provider",
      provider_payment_id: ipn.paymentId,
    });
    await recordAudit(
      supabase,
      "nowpayments_ipn_unverified",
      "warning",
      { provider_payment_id: ipn.paymentId, claimed_status: providerStatus },
      payment.id,
    );
    return {
      ok: false,
      error: "NOWPayments does not report this payment id",
      verified: false,
      providerStatus,
    };
  }

  const providerPayment = lookup.payment;
  // Require every identity field; absent evidence is not evidence of payment.
  if (
    payment.provider !== "nowpayments" ||
    String(payment.provider_payment_id || "") !== ipn.paymentId ||
    providerPayment.paymentId !== ipn.paymentId ||
    !payment.invoice_number ||
    providerPayment.orderId !== payment.invoice_number ||
    !payment.pay_currency ||
    providerPayment.payCurrency?.toLowerCase() !==
      String(payment.pay_currency).toLowerCase() ||
    !payment.payment_address ||
    providerPayment.payAddress !== payment.payment_address ||
    providerPayment.priceCurrency?.toLowerCase() !== "usd" ||
    !providerPayment.priceAmount ||
    !Number.isFinite(Number(providerPayment.priceAmount)) ||
    Math.round(Number(providerPayment.priceAmount) * 100) !==
      Number(payment.amount_cents)
  ) {
    return {
      ok: false,
      error: "Provider payment identity or price could not be verified",
      verified: false,
    };
  }
  const providerReportedStatus = String(
    providerPayment.providerStatus || "",
  ).toLowerCase();

  // NOWPayments' record — not the IPN body — decides the outcome. A `finished`
  // claim the API does not confirm is recorded, never fulfilled.
  if (
    providerStatus === "finished" &&
    !isSuccessfulNowpaymentsStatus(providerReportedStatus)
  ) {
    await recordPaymentEvent(
      supabase,
      payment.id,
      "ipn_unconfirmed_by_provider",
      {
        claimed_status: providerStatus,
        provider_status: providerReportedStatus,
        ipn: safeIpn,
      },
    );
    const mapped =
      mapNowpaymentsStatus(providerReportedStatus) || currentStatus;
    const { error: updateError } = await supabase
      .from("payments")
      .update({
        provider_status: providerReportedStatus,
        provider_response: {
          ipn: safeIpn,
          provider_status: providerReportedStatus,
          corroborated: true,
        },
        ...(!isTerminalInternalStatus(currentStatus) ? { status: mapped } : {}),
      })
      .eq("id", payment.id)
      .in("status", [
        "pending",
        "awaiting_confirmation",
        "partially_confirmed",
      ]);
    if (updateError) throw updateError;
    return {
      ok: true,
      payment,
      status: mapped,
      providerStatus: providerReportedStatus,
      verified: false,
      providerPayment,
    };
  }

  if (providerReportedStatus !== providerStatus) {
    return {
      ok: false,
      retryable: true,
      error: "Provider state changed; retry reconciliation",
      verified: false,
    };
  }

  // Terminal non-success states: failed / expired / refunded / partially_paid.
  // `partially_paid` is terminal for our purposes — it waits for a human, and
  // campaigns never activate on it.
  if (providerStatus !== "finished") {
    return applyTerminalOutcome(
      supabase,
      payment,
      safeIpn,
      providerPayment,
      providerStatus,
      internalStatus,
    );
  }

  // `finished` + corroborated: verify the actually paid crypto amount with
  // integer math before fulfillment. Prefer `actually_paid`, fall back to the
  // required `pay_amount` when the provider omits it.
  const received = providerPayment.actuallyPaid;
  const expected = payment.expected_amount as string | null;
  const verdict = compareCryptoAmounts(received, expected);

  if (verdict === "unknown") {
    await recordPaymentEvent(supabase, payment.id, "amount_unverified", {
      provider_payment_id: ipn.paymentId,
      received,
      expected,
    });
    await recordAudit(
      supabase,
      "nowpayments_ipn_amount_unverified",
      "warning",
      { provider_payment_id: ipn.paymentId },
      payment.id,
    );
    return {
      ok: false,
      error: "Payment amount could not be verified against the expected amount",
      verified: false,
      providerPayment,
      providerStatus,
    };
  }

  if (verdict === "underpaid" || verdict === "overpaid") {
    const { error: updateError } = await supabase.rpc("settle_nowpayment", {
      p_payment: payment.id,
      p_provider: providerPayment.paymentId,
      p_status: verdict,
      p_evidence: {
        ipn: safeIpn,
        provider_status: providerStatus,
        corroborated: true,
        received,
        expected,
      },
    });
    if (updateError) throw updateError;

    await recordPaymentEvent(supabase, payment.id, "amount_mismatch", {
      provider_payment_id: ipn.paymentId,
      verdict,
      received,
      expected,
    });
    await recordAudit(
      supabase,
      `nowpayments_ipn_${verdict}`,
      "warning",
      { provider_payment_id: ipn.paymentId },
      payment.id,
    );
    // The amount is what it is — a retry cannot change it, so the route
    // answers 200 and the payment waits for a human instead of a retry loop.
    return {
      ok: false,
      payment,
      status: verdict,
      providerStatus,
      error: `Payment was ${verdict}`,
      verified: false,
      recorded: true,
      providerPayment,
    };
  }

  // Fully verified. Persist the evidence; the caller performs the actual
  // confirmation so a failure there cannot leave a half-written state.
  const { error: updateError } = await supabase
    .from("payments")
    .update({
      provider_status: providerStatus,
      provider_response: {
        ipn: safeIpn,
        provider_status: providerStatus,
        corroborated: true,
        received,
        expected,
        amount_verified: true,
      },
    })
    .eq("id", payment.id)
    .in("status", [
      "pending",
      "awaiting_confirmation",
      "partially_confirmed",
      "underpaid",
      "overpaid",
    ]);
  if (updateError) throw updateError;

  await recordPaymentEvent(supabase, payment.id, "payment_verified", {
    provider_payment_id: ipn.paymentId,
    provider_status: providerStatus,
    received,
    expected,
  });

  return {
    ok: true,
    payment,
    status: "confirmed",
    providerStatus,
    verified: true,
    providerPayment,
  };
}

async function applyTerminalOutcome(
  supabase: ServiceClient,
  payment: Record<string, unknown> & { id: string },
  safeIpn: Record<string, string>,
  providerPayment: NowpaymentsPayment,
  providerStatus: string,
  internalStatus: string,
): Promise<NowpaymentsIpnResult> {
  const { error } = await supabase.rpc("settle_nowpayment", {
    p_payment: payment.id,
    p_provider: providerPayment.paymentId,
    p_status: internalStatus,
    p_evidence: {
      ipn: safeIpn,
      provider_status: providerStatus,
      corroborated: true,
    },
  });
  if (error) throw error;
  return {
    ok: true,
    payment,
    status: internalStatus,
    providerStatus,
    verified: true,
    recorded: true,
    providerPayment,
  };
}

/**
 * Marks a verified payment paid and moves its invoice and campaigns forward.
 * Safe to call repeatedly: the confirmation update is conditional, so
 * concurrent IPNs cannot confirm the same payment twice.
 */
export async function confirmNowpaymentsPayment(
  paymentId: string,
  providerPaymentId: string,
) {
  const supabase = createServiceClient();
  const { data: payment, error: readError } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single();
  if (readError) throw readError;
  if (!payment) throw new Error("Payment not found");
  const { error } = await supabase.rpc("settle_nowpayment", {
    p_payment: paymentId,
    p_provider: providerPaymentId,
    p_status: "confirmed",
    p_evidence: payment.provider_response,
  });
  if (error) throw error;
  return { confirmed: true };
}
