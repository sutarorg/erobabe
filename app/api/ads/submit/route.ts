import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { limitRequest, RequestError } from "@/lib/http/safety";
import {
  CREATIVE_ACCEPT,
  CreativeValidationError,
  MAX_CREATIVE_BYTES,
  validateCreativeBytes,
} from "@/lib/ads/creative";

export const runtime = "nodejs";

const submissionSchema = z
  .object({
    slotId: z.coerce.number().int().min(1).max(10),
    durationMonths: z.coerce.number().int().refine((value) => [1, 2, 3, 6, 12].includes(value)),
    adName: z.string().trim().min(1).max(160),
    contactName: z.string().trim().min(1).max(120),
    companyName: z.string().trim().max(160).optional().default(""),
    email: z.string().trim().email().max(320),
    aboutAdvertiser: z.string().trim().min(1).max(2000),
    destinationUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value), "Use an http or https URL"),
    paypalTransactionId: z.string().trim().max(128).optional().default(""),
    paymentConfirmed: z.literal("true"),
  })
  .strict();

function errorResponse(error: unknown) {
  if (error instanceof CreativeValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof RequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Ad submission failed", error);
  return NextResponse.json(
    { error: "Unable to submit your ad right now. Please try again." },
    { status: 500 },
  );
}

export async function POST(req: Request) {
  let uploadedPath = "";
  let service: ReturnType<typeof createServiceClient> | null = null;

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_CREATIVE_BYTES + 64 * 1024) {
      throw new RequestError("Ad banner must be 5 MB or smaller.", 413);
    }
    if (!req.headers.get("content-type")?.includes("multipart/form-data")) {
      throw new RequestError("Multipart form data required", 415);
    }

    const form = await req.formData();
    const parsed = submissionSchema.safeParse({
      slotId: form.get("slotId"),
      durationMonths: form.get("durationMonths"),
      adName: form.get("adName"),
      contactName: form.get("contactName"),
      companyName: form.get("companyName") || "",
      email: form.get("email"),
      aboutAdvertiser: form.get("aboutAdvertiser"),
      destinationUrl: form.get("destinationUrl"),
      paypalTransactionId: form.get("paypalTransactionId") || "",
      paymentConfirmed: form.get("paymentConfirmed"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Complete every required field and confirm that you paid with PayPal." },
        { status: 400 },
      );
    }

    const creative = form.get("creative");
    if (
      !creative ||
      typeof creative === "string" ||
      typeof creative.arrayBuffer !== "function" ||
      creative.size < 1
    ) {
      throw new CreativeValidationError("Choose a 16:9 JPG or PNG ad banner.");
    }
    if (creative.size > MAX_CREATIVE_BYTES) {
      throw new CreativeValidationError("Ad banner must be 5 MB or smaller.");
    }
    if (!CREATIVE_ACCEPT.split(",").includes(creative.type)) {
      throw new CreativeValidationError("Ad banner must be a JPG or PNG image.");
    }

    const validated = validateCreativeBytes(Buffer.from(await creative.arrayBuffer()));
    await limitRequest(req, "ad-order-submit", 5);
    service = createServiceClient();

    uploadedPath = `orders/${crypto.randomUUID()}.${validated.extension}`;
    const bucket = service.storage.from("ad-creatives");
    const { error: uploadError } = await bucket.upload(uploadedPath, validated.buffer, {
      contentType: validated.fileType,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error(`Creative upload failed: ${uploadError.message}`);

    const { data: publicData } = bucket.getPublicUrl(uploadedPath);
    if (!publicData.publicUrl.startsWith("https://")) {
      throw new Error("Creative storage did not return a secure public URL");
    }

    const { data, error } = await service.rpc("submit_ad_order", {
      p_slot_id: parsed.data.slotId,
      p_duration_months: parsed.data.durationMonths,
      p_ad_name: parsed.data.adName,
      p_contact_name: parsed.data.contactName,
      p_company_name: parsed.data.companyName,
      p_email: parsed.data.email,
      p_about_advertiser: parsed.data.aboutAdvertiser,
      p_destination_url: parsed.data.destinationUrl,
      p_image_url: publicData.publicUrl,
      p_image_path: uploadedPath,
      p_file_size: validated.buffer.length,
      p_file_type: validated.fileType,
      p_dimensions: validated.dimensions,
      p_paypal_transaction_id: parsed.data.paypalTransactionId,
    });

    if (error || !data) {
      await bucket.remove([uploadedPath]);
      uploadedPath = "";
      if (error?.code === "23P01" || /slot|reserved|unavailable/i.test(error?.message || "")) {
        return NextResponse.json(
          { error: "This ad slot was just reserved. Please go back and choose another slot." },
          { status: 409 },
        );
      }
      throw new Error(error?.message || "Ad order was not created");
    }

    return NextResponse.json({ orderId: data, status: "in_review" }, { status: 201 });
  } catch (error) {
    if (uploadedPath && service) {
      await service.storage.from("ad-creatives").remove([uploadedPath]).catch(() => undefined);
    }
    return errorResponse(error);
  }
}
