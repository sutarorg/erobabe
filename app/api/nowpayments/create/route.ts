import { matchesNowpaymentsQuote } from "@/lib/nowpayments/quote";
import { boundedJson, RequestError } from "@/lib/http/safety";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  createNowpaymentsPayment,
  nowpaymentsIpnUrl,
  resolvePayCurrency,
} from "@/lib/nowpayments/client";
import { getSiteUrl } from "@/lib/site";
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
    chain: z
      .enum(["bitcoin", "binance", "ethereum", "tron", "solana"])
      .default("ethereum"),
  })
  .superRefine((value, ctx) => {
    if (!value.campaignId && !value.campaignIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["campaignIds"],
        message: "At least one campaign is required",
      });
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
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();
    if (
      !profile ||
      profile.role !== "advertiser" ||
      profile.status !== "active"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await boundedJson(req));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { durationMonths, paymentCurrency, chain } = parsed.data;

    // Resolve the exact NOWPayments asset/network before touching the
    // database — unsupported combinations fail fast with a clear error and
    // are never silently substituted.
    const resolved = resolvePayCurrency(paymentCurrency, chain);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const choice = resolved.choice;

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
      return NextResponse.json(
        { error: "One or more campaigns were not found" },
        { status: 404 },
      );
    }
    if (
      campaigns.some(
        (campaign: { payment_id: string | null }) => campaign.payment_id,
      )
    ) {
      return NextResponse.json(
        { error: "A selected campaign already has a payment request" },
        { status: 409 },
      );
    }

    const slotIds: number[] = unique<number>(
      campaigns.map((campaign: { slot_id: number }) =>
        Number(campaign.slot_id),
      ),
    ).sort((a, b) => a - b);
    if (
      requestedSlotIds.length &&
      (requestedSlotIds.length !== slotIds.length ||
        requestedSlotIds.some((slotId) => !slotIds.includes(slotId)))
    ) {
      return NextResponse.json(
        { error: "Campaign slots do not match the requested slots" },
        { status: 400 },
      );
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
      .select("id, slot_id, status, hold_expires_at")
      .in("slot_id", slotIds)
      .in("status", ["active", "paused", "pending_review", "pending_payment"])
      .lte("start_date", endDay)
      .gte("end_date", startDay);
    if (overlappingError) throw overlappingError;

    const conflicts = (overlapping || []).filter(
      (campaign: { id: string; status: string; hold_expires_at?: string }) =>
        !campaignIds.includes(campaign.id) &&
        (campaign.status !== "pending_payment" ||
          !campaign.hold_expires_at ||
          new Date(campaign.hold_expires_at).getTime() > Date.now()),
    );
    if (conflicts.length) {
      const conflictingSlots = unique(
        conflicts.map((campaign: { slot_id: number }) => campaign.slot_id),
      ).join(", ");
      return NextResponse.json(
        {
          error: `Slot${conflicts.length > 1 ? "s" : ""} ${conflictingSlots} are no longer available`,
        },
        { status: 409 },
      );
    }

    const { data: slots, error: slotsError } = await service
      .from("ad_slots")
      .select("id, price_cents")
      .in("id", slotIds);
    if (slotsError) throw slotsError;
    if (!slots || slots.length !== slotIds.length) {
      return NextResponse.json(
        { error: "One or more selected slots were not found" },
        { status: 404 },
      );
    }

    const priceBySlot = new Map<number, number>(
      slots.map((slot: { id: number; price_cents: number }) => [
        Number(slot.id),
        Number(slot.price_cents),
      ]),
    );
    const priceCents: number = slotIds.reduce<number>(
      (sum, slotId) => sum + (priceBySlot.get(slotId) || 0) * durationMonths,
      0,
    );
    if (!priceCents)
      return NextResponse.json(
        { error: "Unable to calculate a price for the selected slots" },
        { status: 400 },
      );

    if (!process.env.NOWPAYMENTS_API_KEY) {
      return NextResponse.json(
        {
          error: "Crypto payments are not configured",
          details: "The NOWPayments API key is missing on the server.",
        },
        { status: 503 },
      );
    }

    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    let payment:
      | (Record<string, unknown> & { id: string; expires_at: string })
      | null = null;

    // Invoice numbers are unique; retrying an extremely unlikely collision
    // keeps the database and NOWPayments in sync without duplicates.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate =
        attempt === 0 ? invoiceNumber : `${invoiceNumber}-${attempt}`;
      const { data, error } = await service
        .from("payments")
        .insert({
          advertiser_id: user.id,
          invoice_number: candidate,
          external_id: `nowpayments:${randomUUID()}`,
          provider: "nowpayments",
          amount_cents: priceCents,
          currency: "USD",
          payment_currency: choice.asset,
          chain: choice.chain,
          pay_currency: choice.payCurrency,
          status: "pending",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (!error) {
        payment = data as Record<string, unknown> & {
          id: string;
          expires_at: string;
        };
        break;
      }
      if ((error as { code?: string }).code !== "23505" || attempt === 2)
        throw error;
    }

    if (!payment) throw new Error("Could not create payment record");
    const orderId = String(payment.invoice_number);

    const { error: claimError } = await service.rpc("claim_checkout", {
      p_payment: payment.id,
      p_campaigns: campaignIds,
      p_advertiser: user.id,
      p_months: durationMonths,
    });
    if (claimError) {
      await service
        .from("payments")
        .update({ status: "failed" })
        .eq("id", payment.id);
      return NextResponse.json(
        {
          error:
            "Inventory or price changed. No provider request was made; refresh availability.",
        },
        { status: 409 },
      );
    }

    const originAmount = (priceCents / 100).toFixed(2);
    let providerPayment;
    try {
      providerPayment = await createNowpaymentsPayment({
        priceAmount: originAmount,
        priceCurrency: "usd",
        payCurrency: choice.payCurrency,
        orderId,
        orderDescription: `Erobabe advertising slots ${slotIds.join(", ")} — ${durationMonths} month${durationMonths > 1 ? "s" : ""}`,
        ipnCallbackUrl: nowpaymentsIpnUrl(getSiteUrl()),
      });
      if (
        !matchesNowpaymentsQuote(providerPayment, {
          orderId,
          payCurrency: choice.payCurrency,
          priceCents,
        })
      ) {
        throw new Error(
          "Provider quote does not match the reserved order; reconciliation required",
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Provider request failed";
      await service
        .from("payments")
        .update({
          provider_response: {
            reconciliation_required: true,
            error: message.slice(0, 300),
          },
        })
        .eq("id", payment.id);
      await service.from("payment_events").insert({
        payment_id: payment.id,
        event_type: "creation_failed",
        payload: {
          error: message.slice(0, 300),
          pay_currency: choice.payCurrency,
        },
      });
      return NextResponse.json(
        {
          error:
            "Provider outcome is uncertain. Do not retry or send funds. Contact support with this payment reference.",
          paymentId: payment.id,
        },
        { status: 502 },
      );
    }

    const { error: paymentUpdateError } = await service
      .from("payments")
      .update({
        provider_payment_id: providerPayment.paymentId,
        provider_status: providerPayment.providerStatus || "waiting",
        payment_address: providerPayment.payAddress,
        expected_amount: providerPayment.payAmount,
        provider_response: providerPayment.raw,
        status: "awaiting_confirmation",
      })
      .eq("id", payment.id);
    if (paymentUpdateError) throw paymentUpdateError;

    const { error: eventError } = await service.from("payment_events").insert({
      payment_id: payment.id,
      event_type: "address_created",
      payload: {
        provider: "nowpayments",
        provider_payment_id: providerPayment.paymentId,
        address: providerPayment.payAddress,
        pay_amount: providerPayment.payAmount,
        pay_currency: choice.payCurrency,
        order_id: orderId,
        slot_ids: slotIds,
      },
    });
    if (eventError) throw eventError;

    await service.from("audit_logs").insert({
      actor_id: user.id,
      action: "payment_request_created",
      target_type: "payment",
      target_id: payment.id,
      level: "info",
      metadata: {
        provider: "nowpayments",
        slotIds,
        campaignIds,
        durationMonths,
        priceCents,
        pay_currency: choice.payCurrency,
      },
    });

    return NextResponse.json({
      paymentId: payment.id,
      invoiceNumber: orderId,
      orderId,
      providerPaymentId: providerPayment.paymentId,
      provider: "nowpayments",
      address: providerPayment.payAddress,
      amount: providerPayment.payAmount,
      payCurrency: choice.payCurrency,
      paymentCurrency: choice.asset,
      network: choice.network,
      chain: choice.chain,
      priceCents,
      priceUSD: priceCents / 100,
      expiresAt: payment.expires_at,
      slotIds,
      campaignIds,
    });
  } catch (error: unknown) {
    if (error instanceof RequestError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("nowpayments/create error", message);
    return NextResponse.json(
      {
        error:
          "Checkout could not complete. Check Billing before retrying; contact support if a payment is pending.",
      },
      { status: 500 },
    );
  }
}
