import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

const schema = z.object({
  password: z.string().min(8).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "advertiser" || profile.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Password must be between 8 and 128 characters" }, { status: 400 });

    const service = createServiceClient();
    const { error } = await service.auth.admin.updateUserById(user.id, { password: parsed.data.password });
    if (error) throw error;

    await service.from("audit_logs").insert({
      actor_id: user.id,
      action: "advertiser_password_changed",
      target_type: "advertiser_profile",
      target_id: user.id,
      level: "info",
    });

    return NextResponse.json({ updated: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unable to change password" }, { status: 500 });
  }
}
