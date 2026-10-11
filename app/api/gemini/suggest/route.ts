import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GeminiError, suggestVideoMetadata } from "@/lib/gemini/client";
import { z } from "zod";

/**
 * Admin-only AI metadata suggestions (Gemini). Generates a title,
 * description, tags, and category for human review — nothing is published
 * automatically.
 */

const bodySchema = z.object({
  title: z.string().max(160).optional().default(""),
  fileName: z.string().max(240).optional().default(""),
  category: z.string().max(80).optional().default(""),
  tags: z.string().max(240).optional().default(""),
});

/** Bounded request body — suggestions need a few hundred bytes, not megabytes. */
const MAX_BODY_BYTES = 16 * 1024;

/** Simple per-user rate limit (per server instance). */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const requestLog = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entries = (requestLog.get(userId) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  entries.push(now);
  requestLog.set(userId, entries);
  return entries.length > RATE_LIMIT_MAX;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).single();
    if (!profile || profile.role !== "admin" || profile.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (isRateLimited(user.id)) {
      return NextResponse.json({ error: "Too many suggestion requests — try again shortly" }, { status: 429 });
    }

    const rawBody = await req.text().catch(() => "");
    if (rawBody.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    let json: unknown = null;
    try {
      json = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    try {
      const suggestion = await suggestVideoMetadata({
        title: parsed.data.title,
        fileName: parsed.data.fileName,
        category: parsed.data.category,
        existingTags: parsed.data.tags,
      });
      return NextResponse.json({
        suggestion,
        note: "AI-generated, requires human review. Not proof of rights or factual attributes.",
      });
    } catch (error: unknown) {
      if (error instanceof GeminiError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
  }
}
