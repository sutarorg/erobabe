import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/resend/client";
import {
  boundedJson,
  escapeHtml,
  limitRequest,
  RequestError,
} from "@/lib/http/safety";
import { z } from "zod";

const schema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value)),
    email: z.string().email().max(254),
    reason: z.string().trim().min(2).max(200),
    details: z.string().max(5000).optional(),
    type: z
      .enum(["video", "advertisement", "copyright", "other"])
      .default("video"),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const body = await boundedJson(req);
    await limitRequest(req, "reports", 3);
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid", details: parsed.error.flatten() },
        { status: 400 },
      );

    const { url, email, reason, details, type } = parsed.data;
    const service = createServiceClient();

    // Try to extract video slug from URL
    let videoId: string | null = null;
    try {
      const u = new URL(url);
      const match = u.pathname.match(/\/video\/([^/]+)/);
      if (match) {
        const slug = match[1];
        const { data: video } = await service
          .from("videos")
          .select("id")
          .eq("slug", slug)
          .single();
        videoId = video?.id || null;
      }
    } catch {}

    const { data: report, error } = await service
      .from("reports")
      .insert({
        type,
        reason,
        content_id: url,
        content_type: "url",
        reported_by: email.split("@")[0],
        email,
        details,
        video_id: videoId,
        status: "new",
      })
      .select()
      .single();

    if (error) throw error;

    // Email acknowledgement
    try {
      await sendEmail({
        to: email,
        subject: "Content removal request received",
        html: `<p>We received your report for ${escapeHtml(url)} with reason: ${escapeHtml(reason)}. We will review within 24–48 hours.</p><p>Case ID: ${report.id}</p>`,
      });
    } catch (e) {
      console.warn("Resend failed for report acknowledgement", {
        reportId: report.id,
      });
    }

    return NextResponse.json({ ok: true, reportId: report.id });
  } catch (e: any) {
    return NextResponse.json(
      {
        error:
          e instanceof RequestError ? e.message : "Unable to submit report",
      },
      { status: e instanceof RequestError ? e.status : 503 },
    );
  }
}
