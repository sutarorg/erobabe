import { createServiceClient } from "@/lib/supabase/server";
import {
  bconCallbackAmountInCoinUnits,
  compareBconAmounts,
  getBconTransaction,
  mapBconStatus,
  type BconCallbackQuery,
  type BconTransaction,
  type BconTxStatus,
} from "@/lib/bcon/client";

/**
 * Bcon callback verification.
 *
 * A callback is an untrusted HTTP request: Bcon documents no signature, so the
 * parameters it carries prove nothing on their own. Every notification is
 * therefore checked against
 *   1. our own `payments` row (external id, receiving address, expected amount), and
 *   2. Bcon's server-side transaction record for the txid
 *      (`GET /api/v1/transactions/<txid>`: address, status, sum, currency),
 * before a payment may ever be marked paid.
 *
 * Nothing in this module invents a confirmation: if a value cannot be verified
 * the payment stays unconfirmed and the mismatch is recorded for review.
 */

/** Fields Bcon documents on a callback — everything else is dropped before storage. */
const CALLBACK_FIELD_WHITELIST = [
  "status",
  "addr",
  "address",
  "memo",
  "value",
  "amount",
  "sum",
  "txid",
  "transaction_id",
  "external_id",
  "currency",
  "currency_id",
  "chain",
  "store_id",
] as const;

const MAX_FIELD_LENGTH = 200;

/**
 * Callback payload safe to persist or log.
 *
 * Never includes `secret` (a shared secret can be embedded in the callback URL)
 * or unbounded attacker-provided values.
 */
export function redactedCallbackPayload(callback: BconCallbackQuery): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of CALLBACK_FIELD_WHITELIST) {
    const value = callback[key];
    if (typeof value !== "string" || !value) continue;
    safe[key] = value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
  }
  return safe;
}

export function paymentAddressesMatch(chain: string | null | undefined, expected: string, received: string) {
  // EVM-family addresses are case-insensitive. Bitcoin, TRON, and Solana
  // encodings are case-sensitive and must match exactly.
  if (["ethereum", "binance"].includes(String(chain).toLowerCase())) {
    return expected.toLowerCase() === received.toLowerCase();
  }
  return expected === received;
}

export type BconCallbackOutcomeStatus = BconTxStatus | "underpaid" | "overpaid";

export interface BconCallbackResult {
  ok: boolean;
  payment?: any;
  status?: BconCallbackOutcomeStatus;
  /** True when a repeated notification for an already confirmed payment arrived. */
  alreadyProcessed?: boolean;
  /** True when no payment in our database matches the notification. */
  unknown?: boolean;
  /** True when Bcon's transaction API independently confirmed the transaction. */
  verified?: boolean;
  /**
   * True when the notification was fully processed and the outcome recorded, so
   * there is nothing a retry could add (e.g. an under/over paid amount).
   */
  recorded?: boolean;
  /** True when Bcon (or the network) failed transiently and the callback should be retried. */
  retryable?: boolean;
  transaction?: BconTransaction;
  error?: string;
}

async function recordPaymentEvent(supabase: any, paymentId: string, eventType: string, payload: unknown) {
  const { error } = await supabase.from("payment_events").insert({
    payment_id: paymentId,
    event_type: eventType,
    payload,
  });
  if (error) console.error(`Bcon callback: could not record ${eventType} event for payment ${paymentId}: ${error.message}`);
}

async function recordAudit(
  supabase: any,
  action: string,
  level: "info" | "warning",
  metadata: Record<string, unknown>,
  paymentId?: string
) {
  const { error } = await supabase.from("audit_logs").insert({
    action,
    target_type: "payment",
    ...(paymentId ? { target_id: paymentId } : {}),
    level,
    metadata,
  });
  if (error) console.error(`Bcon callback: could not write audit log ${action}: ${error.message}`);
}

/**
 * Verify a Bcon callback against trusted records.
 * Idempotent — a repeated callback for the same transaction never confirms twice.
 */
export async function verifyAndProcessBconPayment(callback: BconCallbackQuery): Promise<BconCallbackResult> {
  const supabase = createServiceClient();
  const safeCallback = redactedCallbackPayload(callback);

  const paymentAddress = callback.addr || callback.address || callback.memo;
  const txid = callback.txid || callback.transaction_id;
  const externalId = callback.external_id;
  const rawStatus = typeof callback.status === "string" ? callback.status.trim() : "";

  if (!paymentAddress && !externalId) {
    return { ok: false, error: "Missing address and external_id" };
  }

  // Find the payment by Bcon's external id, else by the receiving address.
  let query = supabase.from("payments").select("*");
  if (externalId) {
    query = query.eq("external_id", externalId);
  } else if (paymentAddress) {
    query = query.eq("payment_address", paymentAddress);
  }

  const { data: payments, error } = await query.limit(1);
  if (error) throw error;
  const payment = payments?.[0];
  if (!payment) {
    // Record the attempt for admin review (no secrets, bounded payload).
    await recordAudit(supabase, "bcon_callback_unknown_payment", "warning", { callback: safeCallback });
    return { ok: false, error: "Payment not found", unknown: true };
  }

  // A callback must identify the payment's actual receiving address. Looking
  // up by external_id is useful, but is not sufficient authentication by
  // itself because an external_id can be guessed.
  if (
    !paymentAddress ||
    !payment.payment_address ||
    !paymentAddressesMatch(payment.chain, payment.payment_address, paymentAddress)
  ) {
    await recordAudit(
      supabase,
      "bcon_callback_address_mismatch",
      "warning",
      { callback: safeCallback, has_address: Boolean(paymentAddress) },
      payment.id
    );
    return { ok: false, error: "Callback address does not match the payment address" };
  }

  // Idempotency: never confirm twice, never downgrade a confirmed payment.
  if (payment.status === "confirmed") {
    await recordPaymentEvent(supabase, payment.id, "callback_repeated", {
      ...safeCallback,
      recorded_transaction_id: payment.transaction_id ?? null,
      already_confirmed: true,
    });
    return { ok: true, alreadyProcessed: true, payment, status: "confirmed", verified: true };
  }

  if (txid) {
    const { data: existingEvents } = await supabase
      .from("payment_events")
      .select("id")
      .eq("payment_id", payment.id)
      .eq("event_type", "confirmed")
      .contains("payload", { transaction_id: txid })
      .limit(1);

    if (existingEvents && existingEvents.length > 0) {
      return { ok: true, alreadyProcessed: true, payment, status: "confirmed", verified: true };
    }
  }

  const callbackStatus = mapBconStatus(rawStatus);

  await recordPaymentEvent(supabase, payment.id, "callback_received", {
    ...safeCallback,
    callback_status: callbackStatus,
    has_txid: Boolean(txid),
  });

  // Only an explicitly confirmed notification ("2" / "confirmed", per Bcon's
  // docs) may move a payment towards `confirmed`. Unconfirmed and partially
  // confirmed notifications are recorded but never marked paid.
  if (callbackStatus !== "confirmed") {
    const updates: Record<string, unknown> = {
      bcon_response: { callback: safeCallback, callback_status: callbackStatus },
    };
    if (txid) updates.transaction_id = txid;
    if (callbackStatus === "partially_confirmed") updates.status = "partially_confirmed";

    const { error: updateError } = await supabase.from("payments").update(updates).eq("id", payment.id);
    if (updateError) throw updateError;

    return { ok: true, payment: { ...payment, ...updates }, status: callbackStatus, verified: false, transaction: undefined };
  }

  // From here on the notification claims a confirmed payment. Every claim has
  // to be corroborated by Bcon's own transaction record.
  if (!txid) {
    await recordPaymentEvent(supabase, payment.id, "verification_failed", { reason: "missing_txid", callback: safeCallback });
    await recordAudit(supabase, "bcon_callback_missing_txid", "warning", { callback: safeCallback }, payment.id);
    return { ok: false, error: "A confirmed callback must include a txid", verified: false };
  }

  const lookup = await getBconTransaction(txid);
  if (!lookup.ok) {
    if (lookup.reason === "api_error") {
      // Bcon (or our network) failed — ask the caller to retry instead of
      // guessing. The payment stays unconfirmed.
      await recordPaymentEvent(supabase, payment.id, "verification_pending", {
        reason: lookup.message,
        txid,
      });
      return { ok: false, retryable: true, error: lookup.message, verified: false };
    }

    await recordPaymentEvent(supabase, payment.id, "verification_failed", { reason: "transaction_not_found", txid });
    await recordAudit(
      supabase,
      "bcon_callback_transaction_unverified",
      "warning",
      { txid, external_id: externalId },
      payment.id
    );
    return { ok: false, error: "Bcon does not report this transaction id", verified: false };
  }

  const transaction = lookup.transaction;

  // Bcon's record — not the query string — decides whether the transaction is
  // confirmed (docs: unconfirmed, partially_confirmed, confirmed after 2 confirmations).
  const transactionStatus = mapBconStatus(transaction.status);
  if (transactionStatus !== "confirmed") {
    await recordPaymentEvent(supabase, payment.id, "callback_unconfirmed_by_provider", {
      txid,
      provider_status: transaction.status,
      callback_status: callbackStatus,
    });
    const updates: Record<string, unknown> = {
      transaction_id: txid,
      bcon_response: { callback: safeCallback, provider_status: transaction.status },
    };
    if (transactionStatus === "partially_confirmed") updates.status = "partially_confirmed";
    const { error: updateError } = await supabase.from("payments").update(updates).eq("id", payment.id);
    if (updateError) throw updateError;
    return { ok: true, payment: { ...payment, ...updates }, status: transactionStatus, verified: false, transaction };
  }

  if (!transaction.address || !paymentAddressesMatch(payment.chain, payment.payment_address, transaction.address)) {
    await recordPaymentEvent(supabase, payment.id, "verification_failed", { reason: "transaction_address_mismatch", txid });
    await recordAudit(
      supabase,
      "bcon_callback_transaction_address_mismatch",
      "warning",
      { txid, address_verified: false },
      payment.id
    );
    return { ok: false, error: "Bcon's transaction record points at a different address", verified: false, transaction };
  }

  if (
    transaction.currency &&
    payment.payment_currency &&
    transaction.currency.toLowerCase() !== String(payment.payment_currency).toLowerCase()
  ) {
    await recordPaymentEvent(supabase, payment.id, "verification_failed", {
      reason: "currency_mismatch",
      txid,
      provider_currency: transaction.currency,
    });
    await recordAudit(supabase, "bcon_callback_currency_mismatch", "warning", { txid, provider_currency: transaction.currency }, payment.id);
    return { ok: false, error: "Bcon's transaction record uses a different currency", verified: false, transaction };
  }

  // Amount: prefer Bcon's own record, fall back to the documented callback
  // value (satoshis on BTC). No amount evidence => no confirmation.
  let amountSource = "provider_transaction_sum";
  let verdict = compareBconAmounts(transaction.sum, payment.expected_amount);
  if (verdict === "unknown") {
    const callbackAmount = bconCallbackAmountInCoinUnits(payment.chain, callback);
    if (callbackAmount) {
      amountSource = `callback_${callbackAmount.source}`;
      verdict = compareBconAmounts(callbackAmount.amount, payment.expected_amount);
    }
  }

  if (verdict === "unknown") {
    await recordPaymentEvent(supabase, payment.id, "amount_unverified", { txid, provider_sum: transaction.sum });
    await recordAudit(supabase, "bcon_callback_amount_unverified", "warning", { txid, provider_sum: transaction.sum }, payment.id);
    return {
      ok: false,
      error: "Payment amount could not be verified against the expected amount",
      verified: false,
      transaction,
    };
  }

  if (verdict === "underpaid" || verdict === "overpaid") {
    const { error: updateError } = await supabase
      .from("payments")
      .update({
        transaction_id: txid,
        status: verdict,
        bcon_response: { callback: safeCallback, provider_status: transaction.status, provider_sum: transaction.sum },
      })
      .eq("id", payment.id);
    if (updateError) throw updateError;

    await recordPaymentEvent(supabase, payment.id, "amount_mismatch", {
      txid,
      verdict,
      amount_source: amountSource,
      provider_sum: transaction.sum,
      expected_amount: payment.expected_amount,
    });
    await recordAudit(supabase, `bcon_callback_${verdict}`, "warning", { txid, provider_sum: transaction.sum }, payment.id);
    // The amount is what it is — a retry cannot change it, so the route answers
    // 200 and the payment waits for a human instead of a retry loop.
    return { ok: false, payment, status: verdict, error: `Payment was ${verdict}`, verified: false, recorded: true, transaction };
  }

  // Fully verified. Persist the evidence; the caller performs the actual
  // confirmation so a failure there cannot leave a half-written state.
  const { error: updateError } = await supabase
    .from("payments")
    .update({
      transaction_id: txid,
      bcon_response: {
        callback: safeCallback,
        provider_status: transaction.status,
        provider_sum: transaction.sum,
        amount_source: amountSource,
        amount_verified: true,
      },
    })
    .eq("id", payment.id);
  if (updateError) throw updateError;

  await recordPaymentEvent(supabase, payment.id, "transaction_verified", {
    txid,
    provider_status: transaction.status,
    provider_sum: transaction.sum,
    amount_source: amountSource,
  });

  return { ok: true, payment, status: "confirmed", verified: true, transaction };
}

/** Marks a verified payment paid and activates its campaigns. */
export async function confirmPayment(paymentId: string, txid: string) {
  const supabase = createServiceClient();

  // Idempotency check
  const { data: payment } = await supabase.from("payments").select("*").eq("id", paymentId).single();
  if (!payment) throw new Error("Payment not found");
  if (payment.status === "confirmed" && payment.transaction_id === txid) {
    return { alreadyConfirmed: true };
  }

  // Update payment to confirmed
  const { error } = await supabase
    .from("payments")
    .update({
      status: "confirmed",
      transaction_id: txid,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", paymentId);

  if (error) throw error;

  // Record event
  await supabase.from("payment_events").insert({
    payment_id: paymentId,
    event_type: "confirmed",
    payload: { transaction_id: txid, confirmed_at: new Date().toISOString() },
  });

  // Update invoice
  if (payment.invoice_number) {
    await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("number", payment.invoice_number);
  }

  // A single checkout can cover multiple slots, so move every linked
  // campaign forward independently after the payment is confirmed.
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, creative_id")
    .eq("payment_id", paymentId);

  if (campaigns?.length) {
    const creativeIds = campaigns.map((campaign: any) => campaign.creative_id).filter(Boolean);
    const { data: creatives } = creativeIds.length
      ? await supabase.from("ad_creatives").select("id, status").in("id", creativeIds)
      : { data: [] as any[] };
    const creativeStatus = new Map((creatives || []).map((creative: any) => [creative.id, creative.status]));

    await Promise.all(
      campaigns.map((campaign: any) =>
        supabase
          .from("campaigns")
          .update({ status: creativeStatus.get(campaign.creative_id) === "approved" ? "active" : "pending_review" })
          .eq("id", campaign.id)
      )
    );
  }

  // Audit log
  await supabase.from("audit_logs").insert({
    action: "payment_confirmed",
    target_type: "payment",
    target_id: paymentId,
    level: "info",
    metadata: { txid, external_id: payment.external_id },
  });

  return { confirmed: true };
}
