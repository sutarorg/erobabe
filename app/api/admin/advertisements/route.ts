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
    action: z.enum(["verify_payment", "make_live", "reject_ad", "delete_ad"]),
  })
  .strict();

/**
 * Delete an advertisement permanently.
 *
 * Removing the order row is what frees the placement and what takes its money
 * out of “Verified Ad Revenue”: the dashboard sums the orders that still exist,
 * so deleting an ad before its 30 days are over can no longer be counted as
 * revenue. The banner file is removed from storage as well, and the audit log
 * keeps what was deleted (and how much verified money left the total).
 */
async function deleteAd(
  service: any,
  adminId: string,
  orderId: string,
): Promise<NextResponse> {
  const { data: order, error: loadError } = await service
    .from("ad_orders")
    .select(
      "id, slot_id, ad_name, status, payment_status, amount_cents, starts_at, ends_at, image_path",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: "Unable to load this advertisement" }, { status: 503 });
  }
  if (!order) {
    return NextResponse.json({ error: "This advertisement no longer exists" }, { status: 404 });
  }

  if (order.image_path) {
    try {
      await service.storage.from("ad-creatives").remove([order.image_path]);
    } catch (error) {
      // The record must still go: a missing file is not a reason to keep
      // counting the order as revenue or to keep the slot blocked.
      console.error("Ad creative deletion failed", error);
    }
  }

  const { error: deleteError } = await service.from("ad_orders").delete().eq("id", order.id);
  if (deleteError) {
    return NextResponse.json({ error: "Unable to delete this advertisement" }, { status: 503 });
  }

  const verifiedCents = order.payment_status === "verified" ? Number(order.amount_cents || 0) : 0;
  const deletedBeforeExpiry =
    Boolean(order.ends_at) && new Date(order.ends_at).getTime() > Date.now();

  const { error: auditError } = await service.from("audit_logs").insert({
    actor_id: adminId,
    action: "ad_order_deleted",
    target_type: "ad_order",
    target_id: order.id,
    level: "warning",
    metadata: {
      slot_id: order.slot_id,
      ad_name: order.ad_name,
      previous_status: order.status,
      payment_status: order.payment_status,
      amount_cents: Number(order.amount_cents || 0),
      verified_cents: verifiedCents,
      deleted_before_expiry: deletedBeforeExpiry,
      ends_at: order.ends_at,
    },
  });
  if (auditError) console.error("Ad deletion audit failed", auditError.code);

  revalidatePublicTag("ads");

  return NextResponse.json({
    deleted: true,
    slotId: order.slot_id,
    revenueExcludedCents: verifiedCents,
    deletedBeforeExpiry,
  });
}

export async function POST(req: Request) {
  try {
    const { user, service } = await requireActiveAdmin();
    const parsed = schema.safeParse(await boundedJson(req, 1024));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid ad review action" }, { status: 400 });
    }

    if (parsed.data.action === "delete_ad") {
      return await deleteAd(service, user.id, parsed.data.id);
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
