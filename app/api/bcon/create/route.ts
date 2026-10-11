import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createBconExternalId, createBconPaymentAddress } from "@/lib/bcon/client";
import { z } from "zod";

const uuid = z.string().uuid();
const schema = z
  .object({
    // Singular fields remain supported for a campaign created before this
    // multi-slot checkout flow was introduced.
    campaignId: uuid.optional(),
    campaignIds: z.array(uuid).min(1).max(10).optional(),
    slotId: z.number().int().min(1).max(10).optional(),
    slotIds: z.array(z.number().int().min(1).max(10)).min(1).max(10).optional(),
    durationMonths: z.number().int().min(1).max(12).default(1),
    paymentCurrency: z.string().trim().min(2).max(16).default("USDT"),
    chain: z.enum(["bitcoin", "binance", "ethereum", "tron", "solana"]).default("ethereum"),
  })
  .superRefine((value, ctx) => {
    if (!value.campaignId && !value.campaignIds?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["campaignIds"], message: "At least one campaign is required" });
    }
  });

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "advertiser" || profile.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { durationMonths, paymentCurrency, chain } = parsed.data;
    const campaignIds: string[] = unique<string>([
      ...(parsed.data.campaignIds || []),
      ...(parsed.data.campaignId ? [parsed.data.campaignId] : []),
    ]);
    const requestedSlotIds: number[] = unique<number>([
      ...(parsed.data.slotIds || []),
      ...(parsed.data.slotId ? [parsed.data.slotId] : []),
    ]);
    const service = createServiceClient();

    // Never trust a browser-provided slot or price. Campaigns must belong to
    // this advertiser and must not already be tied to a payment.
    const { data: campaigns, error: campaignsError } = await service
      .from("campaigns")
      .select("id, slot_id, payment_id")
      .in("id", campaignIds)
      .eq("advertiser_id", user.id);

    if (campaignsError) throw campaignsError;
    if (!campaigns || campaigns.length !== campaignIds.length) {
      return NextResponse.json({ error: "One or more campaigns were not found" }, { status: 404 });
    }
    if (campaigns.some((campaign: any) => campaign.payment_id)) {
      return NextResponse.json({ error: "A selected campaign already has a payment request" }, { status: 409 });
    }

    const slotIds: number[] = unique<number>(campaigns.map((campaign: any) => Number(campaign.slot_id))).sort((a, b) => a - b);
    if (
      requestedSlotIds.length &&
      (requestedSlotIds.length !== slotIds.length || requestedSlotIds.some((slotId) => !slotIds.includes(slotId)))
    ) {
      return NextResponse.json({ error: "Campaign slots do not match the requested slots" }, { status: 400 });
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationMonths * 30);
    const startDay = startDate.toISOString().split("T")[0];
    const endDay = endDate.toISOString().split("T")[0];

    // A campaign is created immediately before this request, so explicitly
    // exclude this checkout's own campaigns from the overlap check.
    const { data: overlapping, error: overlappingError } = await service
      .from("campaigns")
      .select("id, slot_id")
      .in("slot_id", slotIds)
      .in("status", ["active", "pending_review", "pending_payment"])
      .lte("start_date", endDay)
      .gte("end_date", startDay);
    if (overlappingError) throw overlappingError;

    const conflicts = (overlapping || []).filter((campaign: any) => !campaignIds.includes(campaign.id));
    if (conflicts.length) {
      const conflictingSlots = unique(conflicts.map((campaign: any) => campaign.slot_id)).join(", ");
      return NextResponse.json({ error: `Slot${conflicts.length > 1 ? "s" : ""} ${conflictingSlots} are no longer available` }, { status: 409 });
    }

    const { data: slots, error: slotsError } = await service
      .from("ad_slots")
      .select("id, price_cents")
      .in("id", slotIds);
    if (slotsError) throw slotsError;
    if (!slots || slots.length !== slotIds.length) {
      return NextResponse.json({ error: "One or more selected slots were not found" }, { status: 404 });
    }

    const priceBySlot = new Map<number, number>(slots.map((slot: any) => [Number(slot.id), Number(slot.price_cents)]));
    const priceCents: number = slotIds.reduce<number>((sum, slotId) => sum + (priceBySlot.get(slotId) || 0) * durationMonths, 0);
    if (!priceCents) return NextResponse.json({ error: "Unable to calculate a price for the selected slots" }, { status: 400 });

    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    let payment: any = null;
    let externalId = "";

    // External ids are deliberately short for Bcon. Retrying an extremely
    // unlikely unique collision keeps the database and Bcon in sync.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      externalId = createBconExternalId();
      const { data, error } = await service
        .from("payments")
        .insert({
          advertiser_id: user.id,
          invoice_number: invoiceNumber,
          external_id: externalId,
          amount_cents: priceCents,
          currency: "USD",
          payment_currency: paymentCurrency.toUpperCase(),
          chain,
          status: "pending",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (!error) {
        payment = data;
        break;
      }
      if (error.code !== "23505" || attempt === 2) throw error;
    }

    if (!payment) throw new Error("Could not create payment record");

    const originAmount = (priceCents / 100).toFixed(2);
    let bconResult;
    try {
      bconResult = await createBconPaymentAddress({
        payment_currency: paymentCurrency.toUpperCase(),
        origin_amount: originAmount,
        origin_currency: "USD",
        external_id: externalId,
        chain,
      });
    } catch (error: any) {
      await service
        .from("payments")
        .update({ status: "failed", bcon_response: { error: error.message } })
        .eq("id", payment.id);
      return NextResponse.json({ error: "Failed to create payment address", details: error.message }, { status: 502 });
    }

    const { error: paymentUpdateError } = await service
      .from("payments")
      .update({
        payment_address: bconResult.address,
        expected_amount: bconResult.amount,
        bcon_response: bconResult.raw,
        status: "awaiting_confirmation",
      })
      .eq("id", payment.id);
    if (paymentUpdateError) throw paymentUpdateError;

    const { data: invoice, error: invoiceError } = await service
      .from("invoices")
      .insert({
        number: invoiceNumber,
        advertiser_id: user.id,
        payment_id: payment.id,
        amount_cents: priceCents,
        description: `Slots ${slotIds.join(", ")} reservation — ${durationMonths} month${durationMonths > 1 ? "s" : ""}`,
        status: "pending",
        due_date: endDay,
      })
      .select()
      .single();
    if (invoiceError) throw invoiceError;

    const { error: campaignUpdateError } = await service
      .from("campaigns")
      .update({ payment_id: payment.id, invoice_id: invoice?.id })
      .in("id", campaignIds)
      .eq("advertiser_id", user.id);
    if (campaignUpdateError) throw campaignUpdateError;

    const { error: eventError } = await service.from("payment_events").insert({
      payment_id: payment.id,
      event_type: "address_created",
      payload: { address: bconResult.address, amount: bconResult.amount, external_id: externalId, slot_ids: slotIds },
    });
    if (eventError) throw eventError;

    await service.from("audit_logs").insert({
      actor_id: user.id,
      action: "payment_request_created",
      target_type: "payment",
      target_id: payment.id,
      level: "info",
      metadata: { slotIds, campaignIds, durationMonths, priceCents },
    });

    return NextResponse.json({
      paymentId: payment.id,
      invoiceNumber,
      externalId,
      address: bconResult.address,
      amount: bconResult.amount,
      paymentCurrency: paymentCurrency.toUpperCase(),
      chain,
      priceCents,
      priceUSD: priceCents / 100,
      expiresAt: payment.expires_at,
      slotIds,
      campaignIds,
    });
  } catch (error: any) {
    console.error("bcon/create error", error);
    return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 });
  }
}
