import { createServiceClient } from "@/lib/supabase/server";

function paymentAddressesMatch(chain: string | null | undefined, expected: string, received: string) {
  // EVM-family addresses are case-insensitive. Bitcoin, TRON, and Solana
  // encodings are case-sensitive and must match exactly.
  if (["ethereum", "binance"].includes(String(chain).toLowerCase())) {
    return expected.toLowerCase() === received.toLowerCase();
  }
  return expected === received;
}

/**
 * Verify Bcon callback against trusted DB records.
 * Idempotent — repeated callbacks with same txid must not duplicate.
 */
export async function verifyAndProcessBconPayment(
  callback: {
    addr?: string;
    address?: string;
    txid?: string;
    transaction_id?: string;
    value?: string;
    amount?: string;
    external_id?: string;
  }
) {
  const supabase = createServiceClient();

  const paymentAddress = callback.addr || callback.address;
  const txid = callback.txid || callback.transaction_id;
  const externalId = callback.external_id;
  const value = callback.value || callback.amount;

  if (!paymentAddress && !externalId) {
    return { ok: false, error: "Missing address and external_id" };
  }

  // Find payment by external_id or address
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
    // Record exceptional case for admin review
    await supabase.from("audit_logs").insert({
      action: "bcon_callback_unknown_payment",
      target_type: "payment",
      level: "warning",
      metadata: { callback },
    });
    return { ok: false, error: "Payment not found", unknown: true };
  }

  // A callback must identify the payment's actual receiving address. Looking
  // up by external_id is useful, but is not sufficient authentication by
  // itself because an external_id can be guessed.
  if (!paymentAddress || !payment.payment_address || !paymentAddressesMatch(payment.chain, payment.payment_address, paymentAddress)) {
    await supabase.from("audit_logs").insert({
      action: "bcon_callback_address_mismatch",
      target_type: "payment",
      target_id: payment.id,
      level: "warning",
      metadata: { external_id: externalId, has_address: Boolean(paymentAddress) },
    });
    return { ok: false, error: "Callback address does not match payment" };
  }

  // Idempotency: check if txid already processed
  if (txid) {
    const { data: existingEvents } = await supabase
      .from("payment_events")
      .select("id")
      .eq("payment_id", payment.id)
      .eq("event_type", "confirmed")
      .contains("payload", { transaction_id: txid })
      .limit(1);

    if (existingEvents && existingEvents.length > 0) {
      return { ok: true, alreadyProcessed: true, payment };
    }

    // Also check payments table transaction_id
    if (payment.transaction_id === txid && payment.status === "confirmed") {
      return { ok: true, alreadyProcessed: true, payment };
    }
  }

  // Validate amount if present
  // payment.amount_cents is USD cents, expected_amount is crypto amount string
  // We cannot strictly validate USD vs crypto without rate, but we check if value exists
  // For safety, we log under/over payment cases
  let status: string = "awaiting_confirmation";
  let callbackAmount = value ? parseFloat(value) : null;
  let expectedCrypto = payment.expected_amount ? parseFloat(payment.expected_amount) : null;

  // Bcon documents BTC callback values in satoshis while a Bcon address
  // response uses BTC units. Compare like-for-like before deciding whether a
  // payment is under/over the expected amount.
  if (payment.chain === "bitcoin" && callbackAmount !== null && expectedCrypto !== null) {
    expectedCrypto *= 100_000_000;
  }

  if (callbackAmount !== null && expectedCrypto !== null && Number.isFinite(callbackAmount) && Number.isFinite(expectedCrypto)) {
    const diff = Math.abs(callbackAmount - expectedCrypto);
    const tolerance = expectedCrypto * 0.02; // 2% tolerance
    if (diff > tolerance) {
      if (callbackAmount < expectedCrypto) {
        status = "underpaid";
      } else {
        status = "overpaid";
      }
    }
  }

  // If no status override, treat as awaiting_confirmation until confirmed status arrives
  // Bcon docs: confirmed after 2 confirmations
  // For now, if txid present we move to awaiting_confirmation, actual confirmation requires explicit status
  // The callback may include status param; we handle in route handler

  // Record event
  await supabase.from("payment_events").insert({
    payment_id: payment.id,
    event_type: "callback_received",
    payload: { callback, txid, value, status },
  });

  // Update payment record (but don't mark confirmed yet unless caller says so)
  const updates: any = {
    transaction_id: txid || payment.transaction_id,
    bcon_response: callback,
  };
  if (status !== "awaiting_confirmation") {
    updates.status = status;
  }

  await supabase.from("payments").update(updates).eq("id", payment.id);

  return { ok: true, payment, status, txid };
}

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
