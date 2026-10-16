import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { FunnyUsernameError, generateFunnyUsername } from "@/lib/community/anonymous-username";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 20;

const input = z.object({
  videoId: z.string().uuid(),
  visitorId: z.string().uuid(),
  body: z.string().trim().min(1).max(1000).optional(),
  liked: z.boolean().optional(),
});

async function findAnonymousName(db: any, visitorHash: string): Promise<string | null> {
  const { data, error } = await db
    .from("anonymous_comment_profiles")
    .select("profile_name")
    .eq("visitor_hash", visitorHash)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.profile_name === "string" ? data.profile_name : null;
}

/** Return the stable, globally unique, locally generated username assigned to this browser. */
async function getOrCreateAnonymousName(db: any, visitorHash: string): Promise<string> {
  const existing = await findAnonymousName(db, visitorHash);
  if (existing) return existing;

  // The unique index is the final authority. If two requests for the same
  // visitor race, recover that visitor's inserted name; a genuine name
  // collision gets a fresh local name and unique suffix.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generated = generateFunnyUsername();
    const suffix = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    const profileName = `${generated} ${suffix}`;
    const { data, error } = await db
      .from("anonymous_comment_profiles")
      .insert({ visitor_hash: visitorHash, profile_name: profileName })
      .select("profile_name")
      .single();

    if (!error && typeof data?.profile_name === "string") return data.profile_name;
    if (error?.code !== "23505") throw error || new Error("Unable to reserve anonymous username");

    const racedName = await findAnonymousName(db, visitorHash);
    if (racedName) return racedName;
  }

  throw new FunnyUsernameError();
}

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId");
  const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
  const limit = offset === 0 ? 2 : 5;
  if (!z.string().uuid().safeParse(videoId).success || !Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const db = createServiceClient();
    const { data: video } = await db.from("videos").select("id").eq("id", videoId).eq("status", "published").eq("visibility", "public").eq("rights_status", "cleared").eq("moderation_status", "approved").eq("requires_reupload", false).single();
    if (!video) return NextResponse.json({ error: "Video unavailable" }, { status: 404 });
    const { data, error } = await db.from("video_comments").select("id, profile_name, body, created_at").eq("video_id", videoId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit);
    if (error) throw error;
    return NextResponse.json({ comments: data.slice(0, limit), hasMore: data.length > limit });
  } catch { return NextResponse.json({ error: "Comments are unavailable. Please retry." }, { status: 503 }); }
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

  try {
    const parsed = input.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid comment or rating" }, { status: 400 });
    const p = parsed.data;
    const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("Not configured");

    const visitor = createHmac("sha256", secret).update(p.visitorId).digest("hex");
    const db = createServiceClient();
    if (p.liked !== undefined) {
      const { error } = await db.rpc("set_video_like", { p_video: p.videoId, p_visitor: visitor, p_liked: p.liked });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (!p.body) return NextResponse.json({ error: "A comment is required" }, { status: 400 });

    // Only assign usernames for available, published videos.
    const { data: video } = await db
      .from("videos")
      .select("id")
      .eq("id", p.videoId)
      .eq("status", "published")
      .eq("visibility", "public")
      .eq("rights_status", "cleared")
      .eq("moderation_status", "approved")
      .eq("requires_reupload", false)
      .maybeSingle();
    if (!video) return NextResponse.json({ error: "Video unavailable" }, { status: 404 });

    // Keep the existing server-side cooldown in the SQL RPC as the authority.
    // This pre-check avoids reserving a profile for a visitor who is already
    // inside the cooldown window.
    const rateKey = createHmac("sha256", secret)
      .update(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || p.visitorId)
      .digest("hex");
    const { data: recentComment, error: recentError } = await db
      .from("video_comments")
      .select("id")
      .eq("visitor_hash", rateKey)
      .gt("created_at", new Date(Date.now() - 30_000).toISOString())
      .limit(1)
      .maybeSingle();
    if (recentError) throw recentError;
    if (recentComment) return NextResponse.json({ error: "Please wait 30 seconds between comments." }, { status: 429 });

    const profileHash = createHmac("sha256", secret)
      .update(`anonymous-comment-profile:${p.visitorId}`)
      .digest("hex");
    const name = await getOrCreateAnonymousName(db, profileHash);
    const { error } = await db.rpc("post_video_comment", {
      p_video: p.videoId,
      p_name: name,
      p_body: p.body,
      p_visitor: rateKey,
    });
    if (error?.message?.includes("30 seconds")) return NextResponse.json({ error: "Please wait 30 seconds between comments." }, { status: 429 });
    if (error) throw error;
    return NextResponse.json({ ok: true, name });
  } catch (error) {
    if (error instanceof FunnyUsernameError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Unable to save. Please retry." }, { status: 503 });
  }
}
