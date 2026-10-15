import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const input = z.object({ videoId: z.string().uuid(), visitorId: z.string().uuid(),
  name: z.string().regex(/^(Wobbly|Sneaky|Disco|Sleepy|Cosmic|Jolly)(Panda|Potato|Penguin|Pickle|Waffle|Otter)\d{4}$/).optional(),
  body: z.string().trim().min(1).max(1000).optional(), liked: z.boolean().optional() });
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
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("Not configured");
    const visitor = createHmac("sha256", secret).update(p.visitorId).digest("hex");
    const db = createServiceClient();
    if (p.liked !== undefined) {
      const { error } = await db.rpc("set_video_like", { p_video: p.videoId, p_visitor: visitor, p_liked: p.liked });
      if (error) throw error;
    } else {
      if (!p.name || !p.body) return NextResponse.json({ error: "A name and comment are required" }, { status: 400 });
      // IP-derived rate key is never exposed; it prevents rotating local IDs to spam comments.
      const rateKey = createHmac("sha256", secret).update(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || p.visitorId).digest("hex");
      const { error } = await db.rpc("post_video_comment", { p_video: p.videoId, p_name: p.name, p_body: p.body, p_visitor: rateKey });
      if (error?.message.includes("30 seconds")) return NextResponse.json({ error: "Please wait 30 seconds between comments." }, { status: 429 });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Unable to save. Please retry." }, { status: 503 }); }
}
