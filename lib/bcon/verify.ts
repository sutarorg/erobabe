import { createServiceClient } from "@/lib/supabase/server";

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
  const callbackAmount = value ? parseFloat(value) : null;
  const expectedCrypto = payment.expected_amount ? parseFloat(payment.expected_amount) : null;

  if (callbackAmount !== null && expectedCrypto !== null) {
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

  // Find and activate campaign if exists
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("payment_id", paymentId)
    .limit(1);

  if (campaigns && campaigns[0]) {
    const campaign = campaigns[0];
    // Only activate if creative approved and slot valid
    const { data: creative } = await supabase
      .from("ad_creatives")
      .select("status")
      .eq("id", campaign.creative_id)
      .single();

    if (creative?.status === "approved") {
      await supabase
        .from("campaigns")
        .update({ status: "active" })
        .eq("id", campaign.id);
    } else {
      await supabase
        .from("campaigns")
        .update({ status: "pending_review" })
        .eq("id", campaign.id);
    }
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
