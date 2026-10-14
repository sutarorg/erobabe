import { loadInventory } from "@/lib/ads/inventory";
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();
    if (
      !profile ||
      profile.role !== "advertiser" ||
      profile.status !== "active"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ slots: await loadInventory() });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unable to load slot availability" },
      { status: 500 },
    );
  }
}
