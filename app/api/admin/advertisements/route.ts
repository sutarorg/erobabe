import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveAdmin, errorStatusFrom } from "@/lib/video/publishing";
import { boundedJson, RequestError } from "@/lib/http/safety";
import { revalidatePublicTag } from "@/lib/public/revalidate";
import { sendEmail, templateAdLive } from "@/lib/resend/client";

export const runtime = "nodejs";

const schema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(["verify_payment", "make_live", "reject_ad"]),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const { user, service } = await requireActiveAdmin();
    const parsed = schema.safeParse(await boundedJson(req, 1024));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid ad review action" }, { status: 400 });
    }

    const { error } = await service.rpc("admin_review_ad_order", {
      p_admin: user.id,
      p_order_id: parsed.data.id,
      p_action: parsed.data.action,
    });
    if (error) {
      return NextResponse.json(
        { error: error.message || "This ad review action is not permitted." },
        { status: 409 },
      );
    }

    revalidatePublicTag("ads");

    if (parsed.data.action !== "make_live") {
      return NextResponse.json({ updated: true, action: parsed.data.action });
    }

    const { data: order, error: loadError } = await service
      .from("ad_orders")
      .select("id, email, ad_name, slot_id, ends_at, status, live_email_sent_at")
      .eq("id", parsed.data.id)
      .single();
    if (loadError || !order || order.status !== "live") {
      return NextResponse.json({
        updated: true,
        emailSent: false,
        warning: "The ad is live, but the confirmation email could not be prepared.",
      });
    }

    if (order.live_email_sent_at) {
      return NextResponse.json({ updated: true, emailSent: true });
    }

    try {
      await sendEmail(
        templateAdLive(order.email, order.ad_name, order.slot_id, order.ends_at),
      );
      await service
        .from("ad_orders")
        .update({ live_email_sent_at: new Date().toISOString() })
        .eq("id", order.id);
      return NextResponse.json({ updated: true, emailSent: true });
    } catch (emailError) {
      // Fulfilment must not be rolled back because an email provider is down.
      // The operator sees an explicit warning instead of a false success toast.
      console.error("Live ad email failed", emailError);
      return NextResponse.json({
        updated: true,
        emailSent: false,
        warning:
          "The ad is live, but Resend could not send the confirmation email. Check RESEND_API_KEY and RESEND_FROM_EMAIL.",
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to review this ad" },
      { status: error instanceof RequestError ? error.status : errorStatusFrom(error) },
    );
  }
}
