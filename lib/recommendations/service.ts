import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import type { PublicVideo } from "@/lib/public/catalog";
import {
  ALGORITHM_VERSION,
  mostLikedScore,
  isAfterRankCursor,
  isAfterLikeCursor,
  rankCandidates,
  type RecommendationCandidate,
  type RecommendationSurface,
  type ScoringContext,
} from "./ranking";

export const RECOMMENDATION_COOKIE = "erobabe-rec-profile";
const ELIGIBLE = [
  ["status", "published"],
  ["visibility", "public"],
  ["rights_status", "cleared"],
  ["moderation_status", "approved"],
] as const;

type Db = ReturnType<typeof createServiceClient>;
type FeedResult = {
  videos: Array<PublicVideo & { category_id: string | null; like_count: number; reason: string; score: number }>;
  cursor: { date: string; id: string } | null;
  algorithmVersion: string;
  correlationId: string;
  personalized: boolean;
};
function hasPersonalSignals(context: Awaited<ReturnType<typeof loadPersonalContext>>) {
  return context.enabled && (context.preferredCategoryIds.size > 0 || context.interestedVideoIds.size > 0 || context.rejectedVideoIds.size > 0 || context.lessLikeCategoryIds.size > 0 || context.suppressedCategoryIds.size > 0 || context.watchedVideoIds.size > 0);
}

export async function viewerHashFromCookie(): Promise<string | null> {
  try {
    const token = (await cookies()).get(RECOMMENDATION_COOKIE)?.value;
    if (!token || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
    const secret = process.env.ANALYTICS_HASH_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) return null;
    return createHmac("sha256", secret).update(`recommendation-profile:${token}`).digest("hex");
  } catch {
    return null;
  }
}

function eligibleQuery(db: Db, select = "*") {
  let query: any = db.from("videos").select(select).eq("requires_reupload", false);
  for (const [column, value] of ELIGIBLE) query = query.eq(column, value);
  // Publicly discoverable rows need an actual playback identity, not merely metadata.
  query = query.or("playable_url.not.is.null,embed_url.not.is.null");
  return query;
}

function mapCandidate(row: any): RecommendationCandidate & PublicVideo & { reason: string; score: number } {
  const category = Array.isArray(row.category) ? row.category[0] : row.category;
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
    duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    quality: row.quality ? String(row.quality) : null,
    view_count: Number(row.view_count) || 0,
    like_count: Number(row.like_count) || 0,
    published_at: row.published_at || null,
    category_id: row.category_id || null,
    category_label: category?.label || null,
    category_slug: category?.slug || null,
    tag_slugs: row.tag_slugs || [],
    reason: "A fresh discovery",
    score: 0,
  };
}

const VIDEO_SELECT = "id,slug,title,description,thumbnail_url,duration_seconds,quality,view_count,like_count,published_at,category_id,playable_url,embed_url,provider,provider_file_id,category:categories(label,slug)";

async function querySource(db: Db, build: (query: any) => any): Promise<any[]> {
  try {
    const { data, error } = await build(eligibleQuery(db, VIDEO_SELECT));
    if (error) {
      console.warn("[recommendations] candidate-source-failed", error.code || "unknown");
      return [];
    }
    return data || [];
  } catch {
    console.warn("[recommendations] candidate-source-failed", "unknown");
    return [];
  }
}

async function loadPersonalContext(db: Db, viewerHash: string | null) {
  const base = {
    enabled: true,
    preferredCategoryIds: new Set<string>(),
    suppressedCategoryIds: new Set<string>(),
    interestedVideoIds: new Set<string>(),
    rejectedVideoIds: new Set<string>(),
    lessLikeCategoryIds: new Set<string>(),
    exposedVideoIds: new Set<string>(),
    watchedVideoIds: new Set<string>(),
    satisfiedCategoryIds: new Set<string>(),
  };
  if (!viewerHash) return base;
  try {
    const { data: pref, error: prefError } = await db.from("recommendation_preferences").select("personalization_enabled,preferred_category_ids,suppressed_category_ids,consent_expires_at").eq("viewer_hash", viewerHash).maybeSingle();
    if (prefError || !pref?.personalization_enabled || Date.parse(pref.consent_expires_at) <= Date.now()) return base;
    const { data: feedback, error: feedbackError } = await db.from("recommendation_feedback").select("video_id,feedback").eq("viewer_hash", viewerHash).gt("updated_at", new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()).order("updated_at", { ascending: false }).limit(300);
    if (feedbackError) return { ...base, enabled: true };
    const interestedVideoIds = new Set<string>((feedback || []).filter((item: any) => item.feedback === "interested").map((item: any) => String(item.video_id)));
    const rejectedVideoIds = new Set<string>((feedback || []).filter((item: any) => item.feedback === "not_interested").map((item: any) => String(item.video_id)));
    const showLessVideoIds = new Set<string>((feedback || []).filter((item: any) => item.feedback === "show_less").map((item: any) => String(item.video_id)));
    const { data: events, error: eventError } = await db.from("recommendation_events").select("video_id,event_type").eq("viewer_hash", viewerHash).gt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).order("created_at", { ascending: false }).limit(200);
    const exposedVideoIds = new Set<string>();
    const watchedVideoIds = new Set<string>();
    const completedVideoIds: string[] = [];
    if (!eventError) for (const event of events || []) {
      const id = String((event as any).video_id);
      if ((event as any).event_type === "impression") exposedVideoIds.add(id);
      if (["playback_start", "progress_25", "progress_50", "progress_75", "playback_complete"].includes((event as any).event_type)) watchedVideoIds.add(id);
      if ((event as any).event_type === "playback_complete") completedVideoIds.push(id);
    }
    const candidateVideoIds = [...new Set([...interestedVideoIds, ...showLessVideoIds, ...completedVideoIds])].slice(0, 120);
    const categoryRows = candidateVideoIds.length
      ? await db.from("videos").select("id,category_id").in("id", candidateVideoIds)
      : { data: [], error: null };
    const preferenceCategories = new Set<string>((pref.preferred_category_ids || []).map(String));
    for (const row of categoryRows.data || []) {
      if (interestedVideoIds.has(String((row as any).id)) && (row as any).category_id) preferenceCategories.add(String((row as any).category_id));
    }
    const satisfiedCategoryIds = new Set<string>();
    const lessLikeCategoryIds = new Set<string>();
    for (const row of categoryRows.data || []) {
      if (showLessVideoIds.has(String((row as any).id)) && (row as any).category_id) lessLikeCategoryIds.add(String((row as any).category_id));
    }
    for (const row of categoryRows.data || []) {
      if (completedVideoIds.includes(String((row as any).id)) && (row as any).category_id) satisfiedCategoryIds.add(String((row as any).category_id));
    }
    return {
      enabled: true,
      preferredCategoryIds: preferenceCategories,
      suppressedCategoryIds: new Set<string>((pref.suppressed_category_ids || []).map(String)),
      interestedVideoIds,
      rejectedVideoIds,
      lessLikeCategoryIds,
      exposedVideoIds,
      watchedVideoIds,
      satisfiedCategoryIds,
    };
  } catch {
    return base;
  }
}

async function loadCandidates(db: Db, surface: RecommendationSurface, currentId?: string, preferredCategoryIds: Set<string> = new Set()) {
  const queryLimit = 60;
  const tasks: Promise<any[]>[] = [
    querySource(db, (query) => query.order("published_at", { ascending: false }).order("id", { ascending: false }).limit(queryLimit)),
    querySource(db, (query) => query.order("view_count", { ascending: false }).order("id", { ascending: true }).limit(queryLimit)),
    querySource(db, (query) => query.order("like_count", { ascending: false }).order("id", { ascending: true }).limit(queryLimit)),
    querySource(db, (query) => query.order("view_count", { ascending: true }).order("published_at", { ascending: false }).limit(24)),
  ];
  let current: any = null;
  if (currentId) {
    const { data } = await eligibleQuery(db, VIDEO_SELECT).eq("id", currentId).maybeSingle();
    current = data || null;
    if (current?.category_id) tasks.push(querySource(db, (query) => query.eq("category_id", current.category_id).neq("id", currentId).order("published_at", { ascending: false }).limit(queryLimit)));
    const { data: currentTags } = await db.from("video_tags").select("tag_id").eq("video_id", currentId).limit(20);
    const tagIds = (currentTags || []).map((item: any) => item.tag_id).filter(Boolean);
    if (tagIds.length) {
      const { data: tagLinks } = await db.from("video_tags").select("video_id").in("tag_id", tagIds).limit(120);
      const ids = [...new Set((tagLinks || []).map((item: any) => String(item.video_id)).filter((id: string) => id !== currentId))].slice(0, 80);
      if (ids.length) tasks.push(querySource(db, (query) => query.in("id", ids).limit(80)));
    }
  }
  if (preferredCategoryIds.size) {
    const categoryIds = [...preferredCategoryIds].slice(0, 12);
    tasks.push(querySource(db, (query) => query.in("category_id", categoryIds).order("published_at", { ascending: false }).limit(queryLimit)));
  }
  const sourceRows = await Promise.all(tasks);
  const byId = new Map<string, any>();
  for (const row of [current, ...sourceRows.flat()].filter(Boolean)) byId.set(String(row.id), row);
  const rows = [...byId.values()].filter((row) => String(row.id) !== currentId);
  // Tags are fetched in one bounded query for the merged candidate set.
  const ids = rows.map((row) => String(row.id));
  if (ids.length) {
    const { data: tagLinks } = await db.from("video_tags").select("video_id,tag_id,tags:tags(slug)").in("video_id", ids).limit(500);
    const tagsByVideo = new Map<string, string[]>();
    for (const link of tagLinks || []) {
      const tag = Array.isArray((link as any).tags) ? (link as any).tags[0] : (link as any).tags;
      if (!tag?.slug) continue;
      const key = String((link as any).video_id);
      tagsByVideo.set(key, [...(tagsByVideo.get(key) || []), String(tag.slug)]);
    }
    for (const row of rows) row.tag_slugs = tagsByVideo.get(String(row.id)) || [];
  }
  return { current: current ? mapCandidate(current) : null, candidates: rows.map(mapCandidate) };
}

export async function getRecommendationFeed(options: {
  surface: RecommendationSurface;
  currentVideoId?: string;
  limit?: number;
  cursor?: { date: string; id: string };
}): Promise<FeedResult> {
  const correlationId = randomUUID();
  const limit = Math.max(1, Math.min(options.limit || 12, 24));
  const empty: FeedResult = { videos: [], cursor: null, algorithmVersion: ALGORITHM_VERSION, correlationId, personalized: false };
  let db: Db;
  try { db = createServiceClient(); } catch { return empty; }

  if (options.surface === "most_liked") {
    const viewerHash = await viewerHashFromCookie();
    const personal = await loadPersonalContext(db, viewerHash);
    let query: any = eligibleQuery(db, VIDEO_SELECT).order("like_count", { ascending: false }).order("id", { ascending: true });
    if (options.currentVideoId) query = query.neq("id", options.currentVideoId);
    if (options.cursor) query = query.or(`like_count.lt.${Number(options.cursor.date)},and(like_count.eq.${Number(options.cursor.date)},id.gt.${options.cursor.id})`);
    const { data, error } = await query.limit(Math.min(limit + 120, 144));
    if (error) return empty;
    const eligible = (data || []).filter((row: any) =>
      isAfterLikeCursor({ id: String(row.id), like_count: Number(row.like_count) || 0 }, options.cursor) &&
      (!personal.enabled || (
        !personal.rejectedVideoIds.has(String(row.id)) &&
        !personal.suppressedCategoryIds.has(String(row.category_id || ""))
      ))
    );
    const page = eligible.slice(0, limit);
    const last = page.at(-1);
    return { ...empty, personalized: hasPersonalSignals(personal), videos: page.map((row: any) => ({ ...mapCandidate(row), score: mostLikedScore(row.like_count), reason: "Most liked by viewers" })), cursor: eligible.length > limit && last ? { date: String(Number(last.like_count) || 0), id: String(last.id) } : null };
  }

  const viewerHash = await viewerHashFromCookie();
  const personal = await loadPersonalContext(db, viewerHash);
  const { current, candidates } = await loadCandidates(db, options.surface, options.currentVideoId, personal.preferredCategoryIds);
  const context: ScoringContext = {
    surface: options.surface,
    current,
    preferredCategoryIds: personal.enabled ? personal.preferredCategoryIds : undefined,
    suppressedCategoryIds: personal.enabled ? personal.suppressedCategoryIds : undefined,
    interestedVideoIds: personal.enabled ? personal.interestedVideoIds : undefined,
    rejectedVideoIds: personal.enabled ? personal.rejectedVideoIds : undefined,
    lessLikeCategoryIds: personal.enabled ? personal.lessLikeCategoryIds : undefined,
    exposedVideoIds: personal.enabled ? personal.exposedVideoIds : undefined,
    watchedVideoIds: personal.enabled ? personal.watchedVideoIds : undefined,
    satisfiedCategoryIds: personal.enabled ? personal.satisfiedCategoryIds : undefined,
    limit,
  };
  const ranked = rankCandidates(candidates, context);
  const afterCursor = ranked.filter((item) => isAfterRankCursor(item, options.cursor));
  const videos = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > limit;
  const last = videos.at(-1);
  return {
    videos: videos.map((item) => ({ ...item, description: item.description ?? null, thumbnail_url: item.thumbnail_url ?? null, duration_seconds: item.duration_seconds ?? null, quality: item.quality ?? null, view_count: Number(item.view_count) || 0, published_at: item.published_at ?? null, category_label: item.category_label ?? null, category_slug: item.category_slug ?? null, category_id: item.category_id || null, like_count: Number(item.like_count) || 0 })) as FeedResult["videos"],
    cursor: hasMore && last ? { date: String(last.score.toFixed(6)), id: last.id } : null,
    algorithmVersion: ALGORITHM_VERSION,
    correlationId,
    personalized: hasPersonalSignals(personal),
  };
}

export async function latestRecommendations(options: { exclude?: string; cursor?: { date: string; id: string }; limit?: number }) {
  const limit = Math.max(1, Math.min(options.limit || 16, 24));
  try {
    const db = createServiceClient();
    let query: any = eligibleQuery(db, VIDEO_SELECT).not("published_at", "is", null)
      .order("published_at", { ascending: false }).order("id", { ascending: false });
    if (options.exclude) query = query.neq("id", options.exclude);
    if (options.cursor) query = query.or(`published_at.lt.${options.cursor.date},and(published_at.eq.${options.cursor.date},id.lt.${options.cursor.id})`);
    const { data, error } = await query.limit(limit + 1);
    if (error) throw error;
    const rows = (data || []).slice(0, limit);
    const last = rows.at(-1);
    return { videos: rows.map((row: any) => mapCandidate(row)), cursor: data?.length > limit && last ? { date: String(last.published_at), id: String(last.id) } : null };
  } catch {
    return { videos: [], cursor: null };
  }
}
