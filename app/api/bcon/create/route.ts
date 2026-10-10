import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createBconPaymentAddress } from "@/lib/bcon/client";
import { z } from "zod";

const schema = z.object({
  campaignId: z.string().uuid().optional(),
  slotId: z.number().int().min(1).max(10),
  creativeId: z.string().uuid().optional(),
  durationMonths: z.number().int().min(1).max(12).default(1),
  paymentCurrency: z.string().default("USDT"),
  chain: z.string().default("ethereum"),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Check advertiser role
    const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).single();
    if (!profile || profile.role !== "advertiser" || profile.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { slotId, durationMonths, paymentCurrency, chain, campaignId } = parsed.data;

    // Verify slot exists and check overlapping reservations using service client for transaction safety
    const service = createServiceClient();

    // Check slot availability with transaction-like logic
    // Look for active campaigns overlapping now + duration
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationMonths * 30);

    const { data: overlapping } = await service
      .from("campaigns")
      .select("id")
      .eq("slot_id", slotId)
      .in("status", ["active", "pending_review", "pending_payment"])
      .lte("start_date", endDate.toISOString().split("T")[0])
      .gte("end_date", startDate.toISOString().split("T")[0])
      .limit(1);

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json({ error: "Slot not available for selected period" }, { status: 409 });
    }

    // Calculate price: $99 per month = 9900 cents
    const priceCents = 9900 * durationMonths;
    const originAmount = (priceCents / 100).toString(); // USD

    // Create invoice number and external_id
    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const externalId = `erobabe-${user.id.slice(0, 8)}-${Date.now()}`;

    // Create payment record pending
    const { data: payment, error: paymentError } = await service
      .from("payments")
      .insert({
        advertiser_id: user.id,
        invoice_number: invoiceNumber,
        external_id: externalId,
        amount_cents: priceCents,
        currency: "USD",
        payment_currency: paymentCurrency,
        chain,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour expiry
      })
      .select()
      .single();

    if (paymentError) throw paymentError;

    // Create Bcon address
    let bconResult;
    try {
      bconResult = await createBconPaymentAddress({
        payment_currency: paymentCurrency,
        origin_amount: originAmount,
        origin_currency: "USD",
        external_id: externalId,
        chain,
      });
    } catch (e: any) {
      // Update payment to failed and return error
      await service.from("payments").update({ status: "failed", bcon_response: { error: e.message } }).eq("id", payment.id);
      return NextResponse.json({ error: "Failed to create payment address", details: e.message }, { status: 502 });
    }

    // Update payment with address
    await service
      .from("payments")
      .update({
        payment_address: bconResult.address,
        expected_amount: bconResult.amount,
        bcon_response: bconResult.raw,
        status: "awaiting_confirmation",
      })
      .eq("id", payment.id);

    // Create invoice
    const { data: invoice } = await service
      .from("invoices")
      .insert({
        number: invoiceNumber,
        advertiser_id: user.id,
        payment_id: payment.id,
        amount_cents: priceCents,
        description: `Slot ${slotId} reservation — ${durationMonths} month${durationMonths > 1 ? "s" : ""}`,
        status: "pending",
        due_date: endDate.toISOString().split("T")[0],
      })
      .select()
      .single();

    // If campaignId provided, link payment to campaign
    if (campaignId) {
      await service.from("campaigns").update({ payment_id: payment.id, invoice_id: invoice?.id }).eq("id", campaignId).eq("advertiser_id", user.id);
    }

    // Record payment event
    await service.from("payment_events").insert({
      payment_id: payment.id,
      event_type: "address_created",
      payload: { address: bconResult.address, amount: bconResult.amount, external_id: externalId },
    });

    // Audit log
    await service.from("audit_logs").insert({
      actor_id: user.id,
      action: "payment_request_created",
      target_type: "payment",
      target_id: payment.id,
      level: "info",
      metadata: { slotId, durationMonths, priceCents },
    });

    return NextResponse.json({
      paymentId: payment.id,
      invoiceNumber,
      externalId,
      address: bconResult.address,
      amount: bconResult.amount,
      paymentCurrency,
      chain,
      priceCents,
      priceUSD: priceCents / 100,
      expiresAt: payment.expires_at,
    });
  } catch (e: any) {
    console.error("bcon/create error", e);
    return NextResponse.json({ error: "Internal server error", details: e.message }, { status: 500 });
  }
}
