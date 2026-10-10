import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/resend/client";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  topic: z.string(),
  message: z.string().min(10),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

    const { name, email, topic, message } = parsed.data;
    const service = createServiceClient();

    const { data: ticket, error } = await service
      .from("support_tickets")
      .insert({
        email,
        subject: `${topic} — from ${name}`,
        message,
        status: "open",
      })
      .select()
      .single();

    if (error) throw error;

    // Try to send email notification to support (if Resend configured)
    try {
      const supportEmail = process.env.RESEND_FROM_EMAIL || process.env.SUPPORT_EMAIL;
      if (supportEmail) {
        await sendEmail({
          to: supportEmail,
          subject: `New support ticket: ${topic}`,
          html: `<p>From: ${name} &lt;${email}&gt;</p><p>Topic: ${topic}</p><p>${message}</p>`,
        });
      }
    } catch (e) {
      console.warn("Resend failed for support ticket", e);
      // Don't fail the request if email fails
    }

    return NextResponse.json({ ok: true, ticketId: ticket.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
