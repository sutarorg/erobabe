import { NextRequest, NextResponse } from "next/server";
import {
  boundedJson,
  escapeHtml,
  limitRequest,
  RequestError,
} from "@/lib/http/safety";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/resend/client";
import { z } from "zod";

const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().email().max(254),
    topic: z.string().trim().min(2).max(160),
    message: z.string().trim().min(10).max(5000),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const body = await boundedJson(req);
    await limitRequest(req, "support", 3);
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (user) {
      const { data: profile } = await auth
        .from("profiles")
        .select("status")
        .eq("id", user.id)
        .single();
      if (profile?.status !== "active")
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const input =
      user && body && typeof body === "object"
        ? { ...body, email: user.email, name: "Advertiser" }
        : body;
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid" }, { status: 400 });

    const { name, email, topic, message } = parsed.data;
    const service = createServiceClient();

    const { data: ticket, error } = await service
      .from("support_tickets")
      .insert({
        email,
        advertiser_id: user?.id || null,
        subject: `${topic} — from ${name}`,
        message,
        status: "open",
      })
      .select()
      .single();

    if (error) throw error;

    // Try to send email notification to support (if Resend configured)
    try {
      const supportEmail = process.env.SUPPORT_EMAIL;
      if (supportEmail) {
        await sendEmail({
          to: supportEmail,
          subject: `New support ticket: ${topic}`,
          html: `<p>From: ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p>Topic: ${escapeHtml(topic)}</p><p>${escapeHtml(message)}</p>`,
        });
      }
    } catch (e) {
      console.warn("Resend failed for support ticket", { ticketId: ticket.id });
      // Don't fail the request if email fails
    }

    return NextResponse.json({ ok: true, ticketId: ticket.id });
  } catch (e: any) {
    return NextResponse.json(
      {
        error:
          e instanceof RequestError ? e.message : "Unable to submit ticket",
      },
      { status: e instanceof RequestError ? e.status : 503 },
    );
  }
}
