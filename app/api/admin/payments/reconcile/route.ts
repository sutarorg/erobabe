import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveAdmin, errorStatusFrom } from "@/lib/video/publishing";
import { boundedJson, RequestError } from "@/lib/http/safety";
import { getNowpaymentsPayment } from "@/lib/nowpayments/client";
import {
  verifyAndProcessNowpaymentsIpn,
  confirmNowpaymentsPayment,
} from "@/lib/nowpayments/verify";
export async function POST(req: Request) {
  try {
    const { service } = await requireActiveAdmin();
    const parsed = z
      .object({
        paymentId: z.string().uuid(),
        providerPaymentId: z.string().regex(/^\d{1,40}$/),
      })
      .strict()
      .safeParse(await boundedJson(req, 1024));
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid reference" }, { status: 400 });
    const { data: p, error } = await service
      .from("payments")
      .select("*")
      .eq("id", parsed.data.paymentId)
      .single();
    if (error || !p)
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    const lookup = await getNowpaymentsPayment(parsed.data.providerPaymentId);
    if (!lookup.ok)
      return NextResponse.json(
        { error: "Provider lookup unavailable" },
        { status: 503 },
      );
    const remote = lookup.payment;
    if (
      p.provider !== "nowpayments" ||
      remote.paymentId !== parsed.data.providerPaymentId ||
      remote.orderId !== p.invoice_number ||
      remote.payCurrency?.toLowerCase() !== p.pay_currency ||
      remote.priceCurrency?.toLowerCase() !== "usd" ||
      !remote.priceAmount ||
      Math.round(Number(remote.priceAmount) * 100) !== p.amount_cents ||
      !remote.payAddress ||
      !remote.payAmount
    )
      return NextResponse.json(
        { error: "Provider identity, order or price mismatch" },
        { status: 409 },
      );
    if (!p.provider_payment_id) {
      const { error } = await service.rpc("bind_nowpayment", {
        p_payment: p.id,
        p_provider: remote.paymentId,
        p_address: remote.payAddress,
        p_amount: remote.payAmount,
      });
      if (error) throw error;
    } else if (p.provider_payment_id !== remote.paymentId)
      return NextResponse.json(
        { error: "Provider identity mismatch" },
        { status: 409 },
      );
    const result = await verifyAndProcessNowpaymentsIpn(remote.raw);
    if (result.ok && result.verified && result.status === "confirmed")
      await confirmNowpaymentsPayment(p.id, remote.paymentId);
    return NextResponse.json(
      { status: result.status || "unverified", verified: !!result.verified },
      { status: result.ok || result.recorded ? 200 : 409 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Reconciliation unavailable; preserve references and retry safely.",
      },
      { status: e instanceof RequestError ? e.status : errorStatusFrom(e) },
    );
  }
}
