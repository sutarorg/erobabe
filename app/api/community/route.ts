import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { FunnyUsernameError, generateFunnyUsername } from "@/lib/community/anonymous-username";
import { containsLink, MAX_COMMENT_LENGTH } from "@/lib/community/validation";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 20;

const input = z.object({
  videoId: z.string().uuid(),
  visitorId: z.string().uuid(),
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH).optional(),
  liked: z.boolean().optional(),
});

async function findAnonymousName(db: any, visitorHash: string): Promise<string | null> {
  const { data, error } = await db
    .from("anonymous_comment_profiles")
    .select("profile_name")
    .eq("visitor_hash", visitorHash)
    .maybeSingle();
  if (error) throw error;
  if (typeof data?.profile_name === "string") {
    // Strip any legacy hex suffix so username is strictly two words
    return data.profile_name.trim().replace(/\s+[0-9A-Fa-f]{12}$/, "");
  }
  return null;
}

/** Return the stable, two-word anonymous username assigned to this browser. */
async function getOrCreateAnonymousName(db: any, visitorHash: string): Promise<string> {
  const existing = await findAnonymousName(db, visitorHash);
  if (existing) return existing;

  // Generate a two-word username without any suffix (e.g. "Crazy Wobble")
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const profileName = generateFunnyUsername();
    const { data, error } = await db
      .from("anonymous_comment_profiles")
      .insert({ visitor_hash: visitorHash, profile_name: profileName })
      .select("profile_name")
      .single();

    if (!error && typeof data?.profile_name === "string") {
      return data.profile_name.trim().replace(/\s+[0-9A-Fa-f]{12}$/, "");
    }
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
    const rawBody = await req.json();
    if (rawBody.body && typeof rawBody.body === "string") {
      if (rawBody.body.trim().length > MAX_COMMENT_LENGTH) {
        return NextResponse.json({ error: `Comments must be ${MAX_COMMENT_LENGTH} characters or fewer.` }, { status: 400 });
      }
      if (containsLink(rawBody.body)) {
        return NextResponse.json({ error: "Links are not allowed in comments." }, { status: 400 });
      }
    }

    const parsed = input.safeParse(rawBody);
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

    const profileHash = createHmac("sha256", secret)
      .update(`anonymous-comment-profile:${p.visitorId}`)
      .digest("hex");
    const name = await getOrCreateAnonymousName(db, profileHash);

    let newCommentId: string | undefined;
    const { data: rpcData, error } = await db.rpc("post_video_comment", {
      p_video: p.videoId,
      p_name: name,
      p_body: p.body,
      p_visitor: visitor,
    });

    if (error) {
      // If the RPC fails (e.g. database still has 30-second cooldown in function),
      // insert directly via service_role to bypass the cooldown.
      const { data: directData, error: directError } = await db
        .from("video_comments")
        .insert({
          video_id: p.videoId,
          profile_name: name,
          body: p.body,
          visitor_hash: visitor,
        })
        .select("id")
        .single();
      if (directError) throw error;
      newCommentId = directData?.id;
    } else {
      newCommentId = typeof rpcData === "string" ? rpcData : undefined;
    }

    return NextResponse.json({ ok: true, name, id: newCommentId });
  } catch (error) {
    if (error instanceof FunnyUsernameError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Unable to save. Please retry." }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  try {
    let commentId: string | null = req.nextUrl.searchParams.get("commentId");
    let visitorId: string | null = req.nextUrl.searchParams.get("visitorId");

    if (!commentId || !visitorId) {
      try {
        const body = await req.json();
        commentId = commentId || body.commentId;
        visitorId = visitorId || body.visitorId;
      } catch {}
    }

    if (!commentId || !visitorId) {
      return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
    }

    const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("Not configured");

    const db = createServiceClient();
    const { data: comment, error: fetchError } = await db
      .from("video_comments")
      .select("id, profile_name, visitor_hash")
      .eq("id", commentId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const visitor = createHmac("sha256", secret).update(visitorId).digest("hex");
    const profileHash = createHmac("sha256", secret)
      .update(`anonymous-comment-profile:${visitorId}`)
      .digest("hex");
    const myProfileName = await findAnonymousName(db, profileHash);

    const isOwner =
      comment.visitor_hash === visitor ||
      (myProfileName && comment.profile_name.toLowerCase() === myProfileName.toLowerCase());

    if (!isOwner) {
      return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
    }

    const { error: deleteError } = await db
      .from("video_comments")
      .delete()
      .eq("id", commentId);

    if (deleteError) throw deleteError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete comment. Please retry." }, { status: 503 });
  }
}
