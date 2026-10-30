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
    // Optional: the checkout labels “About you” as optional.
    aboutAdvertiser: z.string().trim().max(2000).optional().default(""),
    destinationUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value), "Use an http or https URL"),
    paypalTransactionId: z.string().trim().max(128).optional().default(""),
    // Payment happens on the hosted payment page *after* the order exists, so
    // the confirmation is recorded by the operator during review. The flag is
    // only accepted for older clients that still send it — it must never be
    // required, because checkout does not send it at all.
    paymentConfirmed: z
      .union([z.literal("true"), z.literal(""), z.undefined()])
      .optional()
      .transform(() => undefined),
  })
  .strict();

/**
 * Form fields arrive as `null` when absent, which every Zod string rejects.
 * Normalising first means a missing optional field is simply missing, instead
 * of failing the whole submission with a message about a banner.
 */
function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : value;
}

const FIELD_LABELS: Record<string, string> = {
  slotId: "an ad slot",
  durationMonths: "a duration",
  adName: "an ad name",
  contactName: "your name",
  email: "a valid email address",
  destinationUrl: "a full https:// destination URL",
};

/**
 * Says which field the submission is missing, and stops claiming the banner is
 * to blame for a problem that has nothing to do with it.
 */
function validationMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Check the form and try again.";
  const key = String(first.path[0] ?? "");
  const label = FIELD_LABELS[key];
  if (label) return `Enter ${label} and try again.`;
  if (key === "slotId") return "Choose an ad slot and try again.";
  return "Check the form and try again.";
}

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
      slotId: field(form, "slotId"),
      durationMonths: field(form, "durationMonths"),
      adName: field(form, "adName"),
      contactName: field(form, "contactName"),
      companyName: field(form, "companyName") ?? "",
      email: field(form, "email"),
      aboutAdvertiser: field(form, "aboutAdvertiser") ?? "",
      destinationUrl: field(form, "destinationUrl"),
      paypalTransactionId: field(form, "paypalTransactionId") ?? "",
      paymentConfirmed: field(form, "paymentConfirmed") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
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
