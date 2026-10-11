import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional();
const profileSchema = z.object({
  displayName: optionalText(80),
  companyName: z.string().trim().min(2).max(160),
  contactName: optionalText(160),
  website: z.string().trim().max(500).optional(),
  country: optionalText(100),
});
const deleteSchema = z.object({ confirmation: z.literal("DELETE") });

function normalizeWebsite(value?: string) {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Website must be a valid http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Website must use http or https");
  }
  return url.toString();
}

async function requireAdvertiser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "advertiser" || profile.status !== "active") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdvertiser();
    if ("error" in auth) return auth.error;

    const parsed = profileSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid profile", details: parsed.error.flatten() }, { status: 400 });

    const website = normalizeWebsite(parsed.data.website);
    const service = createServiceClient();
    const profileUpdate = {
      display_name: parsed.data.displayName || null,
      company_name: parsed.data.companyName,
      contact_name: parsed.data.contactName || null,
      website,
      country: parsed.data.country || null,
    };

    const { error: baseError } = await service.from("profiles").update(profileUpdate).eq("id", auth.user.id);
    if (baseError) throw baseError;

    const { data: advertiserProfile, error: advertiserError } = await service
      .from("advertiser_profiles")
      .upsert(
        {
          id: auth.user.id,
          company_name: parsed.data.companyName,
          contact_name: parsed.data.contactName || null,
          website,
          country: parsed.data.country || null,
        },
        { onConflict: "id" }
      )
      .select()
      .single();
    if (advertiserError) throw advertiserError;

    await service.from("audit_logs").insert({
      actor_id: auth.user.id,
      action: "advertiser_profile_updated",
      target_type: "advertiser_profile",
      target_id: auth.user.id,
      level: "info",
    });

    return NextResponse.json({ profile: advertiserProfile, displayName: profileUpdate.display_name });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unable to update profile" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAdvertiser();
    if ("error" in auth) return auth.error;

    const parsed = deleteSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Type DELETE to confirm account deletion" }, { status: 400 });

    const service = createServiceClient();
    await service.from("audit_logs").insert({
      actor_id: auth.user.id,
      action: "advertiser_account_deleted",
      target_type: "advertiser_profile",
      target_id: auth.user.id,
      level: "warning",
    });

    const { error } = await service.auth.admin.deleteUser(auth.user.id);
    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unable to delete account" }, { status: 500 });
  }
}
