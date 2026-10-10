import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestVideoMetadata } from "@/lib/groq/client";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { title, fileName, category, tags } = body;

    try {
      const suggestion = await suggestVideoMetadata({ title, fileName, category, existingTags: tags });
      return NextResponse.json({ suggestion, note: "AI-generated, requires human review. Not proof of rights or factual attributes." });
    } catch (e: any) {
      if (e.message.includes("Groq not configured")) {
        return NextResponse.json({ error: "Groq not configured", details: "Set GROQ_API_KEY env var" }, { status: 503 });
      }
      throw e;
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
