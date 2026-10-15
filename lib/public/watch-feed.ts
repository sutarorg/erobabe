import { createClient } from "@/lib/supabase/server";
import type { PublicVideo } from "./catalog";
export type FeedCursor = { date: string; id: string };
export async function watchFeed(mode: "latest" | "recommended" | "rated", exclude: string, cursor?: FeedCursor, limit = 16) {
  const db = await createClient();
  let query = db.from("videos").select("id, slug, title, description, thumbnail_url, duration_seconds, quality, view_count, published_at")
    .eq("requires_reupload", false).eq("status", "published").eq("visibility", "public").eq("rights_status", "cleared").eq("moderation_status", "approved").neq("id", exclude);
  if (mode === "recommended") query = query.order("view_count", { ascending: false });
  if (mode === "rated") query = query.order("like_count", { ascending: false });
  query = query.not("published_at", "is", null).order("published_at", { ascending: false }).order("id", { ascending: false });
  if (cursor) query = query.or(`published_at.lt.${cursor.date},and(published_at.eq.${cursor.date},id.lt.${cursor.id})`);
  const { data, error } = await query.limit(limit + 1);
  if (error) throw error;
  const rows = (data || []).slice(0, limit);
  const last = rows[rows.length - 1];
  return { videos: rows.map((row: any) => ({ ...row, category_label: null, category_slug: null })) as PublicVideo[],
    cursor: (data || []).length > limit && last ? { date: last.published_at as string, id: last.id as string } : null };
}
