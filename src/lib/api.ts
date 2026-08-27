/**
 * Public data layer.
 *
 * In Demo Mode (default) the catalog is served from the local dataset, merged
 * live with anything created/edited through the admin CMS (persisted in
 * localStorage under ADMIN_KEY). Set VITE_DEMO_MODE=false and point
 * VITE_API_BASE_URL at the deployed API to run against Supabase + R2 instead —
 * the function signatures stay identical.
 */
import { CATEGORIES, VIDEOS, VIRTUAL_CATEGORY_SORT, slugify, trendingScore, type Category, type Video } from "../data/videos";
import { getViewEvents, recordLocalView, seedDemoAnalytics } from "./store";

export const DEMO_MODE = (import.meta.env.VITE_DEMO_MODE ?? "true") !== "false";
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
export const ADMIN_KEY = "eb:admin:v1";

/* ------------------------------------------------------------------ */
/* Shapes shared with the admin store (kept structural, not imported,  */
/* to avoid pulling the whole admin bundle into the public chunk).     */
/* ------------------------------------------------------------------ */

export type VideoStatus = "DRAFT" | "PROCESSING" | "READY" | "PUBLISHED" | "UNPUBLISHED" | "FAILED";

export interface AdminVideoShape extends Video {
  status: VideoStatus;
  fileName?: string;
  fileSize?: number;
  sourceEphemeral?: boolean; // demo upload whose object URL is session-only
  updatedAt?: string;
  publishedAt?: string | null;
  seoTitle?: string;
  seoDescription?: string;
  error?: string;
  scheduledAt?: string | null;
}

export interface AdminStateShape {
  videos: AdminVideoShape[];
  categories: (Category & { order: number; description?: string })[];
  settings: SiteSettings;
  tags?: { name: string; createdAt: string }[];
  activity?: unknown[];
  version?: number;
}

export interface SiteSettings {
  siteName: string;
  siteTagline: string;
  ageGateEnabled: boolean;
  ageGateMessage: string;
  viewsEnabled: boolean;
  viewThresholdSec: number;
  sections: { featured: boolean; trending: boolean; popular: boolean; newest: boolean; categories: boolean; mostWatched: boolean };
}

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "EroBabe",
  siteTagline: "Premium adult video streaming",
  ageGateEnabled: true,
  ageGateMessage: "You must be 18 years or older to enter EroBabe.",
  viewsEnabled: true,
  viewThresholdSec: 10,
  sections: { featured: true, trending: true, popular: true, newest: true, categories: true, mostWatched: true },
};

/** Bump when the taxonomy/shape changes — older admin states get migrated. */
export const STATE_VERSION = 2;

/** v1 → v2: categories were replaced by the 14-icon taxonomy. */
const V1_CATEGORY_MAP: Record<string, string> = {
  studio: "hardcore",
  couples: "threesome",
  solo: "masturbation",
  premium: "creampie",
  compilation: "asian",
  cinematic: "lesbian",
  boudoir: "massage",
  noir: "ebony",
  luxury: "blonde",
  amateur: "amateur",
};

export function readAdminState(): AdminStateShape | null {
  try {
    const raw = localStorage.getItem(ADMIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminStateShape;
    if ((parsed.version ?? 1) < STATE_VERSION) {
      parsed.categories = CATEGORIES.map((c, i) => ({ ...c, order: i }));
      parsed.videos = (parsed.videos ?? []).map((v) => ({
        ...v,
        category: parsed.categories.some((c) => c.slug === v.category)
          ? v.category
          : V1_CATEGORY_MAP[v.category] ?? "amateur",
      }));
      parsed.version = STATE_VERSION;
      try {
        localStorage.setItem(ADMIN_KEY, JSON.stringify(parsed));
      } catch {
        /* quota — non-fatal */
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Unified category list — base taxonomy overlaid with live admin edits so
 * the public site and the CMS never drift out of sync.
 */
export function getCategories(): Category[] {
  if (!DEMO_MODE) return CATEGORIES;
  const admin = readAdminState();
  if (!admin?.categories?.length) return CATEGORIES;
  return [...admin.categories]
    .sort((a, b) => a.order - b.order)
    .map((c) => {
      const base = CATEGORIES.find((b) => b.slug === c.slug);
      return { ...(base ?? c), ...c } as Category;
    });
}

export function getSettings(): SiteSettings {
  return readAdminState()?.settings ?? DEFAULT_SETTINGS;
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

const latency = () => new Promise((r) => setTimeout(r, 60 + Math.random() * 180));

/** All publicly visible videos (PUBLISHED only). */
export function getCatalog(): Video[] {
  if (!DEMO_MODE) return VIDEOS;
  const admin = readAdminState();
  if (!admin) return VIDEOS;
  const published = admin.videos
    .filter((v) => v.status === "PUBLISHED")
    .map((v) => ({ ...v }));
  return published.length ? published : VIDEOS;
}

export async function listVideos(opts: {
  sort?: "popular" | "newest" | "viewed" | "trending";
  category?: string;
  limit?: number;
  exclude?: string;
} = {}): Promise<Video[]> {
  if (!DEMO_MODE) {
    const q = new URLSearchParams();
    if (opts.sort) q.set("sort", opts.sort);
    if (opts.category) q.set("category", opts.category);
    const res = await fetch(`${API_BASE}/videos?${q}`);
    if (res.ok) return (await res.json()) as Video[];
  }
  let list = getCatalog().filter((v) => v.id !== opts.exclude);
  let sort = opts.sort ?? "popular";
  if (opts.category && VIRTUAL_CATEGORY_SORT[opts.category]) {
    // feed-style categories (trending/popular/new) — no slug filter
    sort = VIRTUAL_CATEGORY_SORT[opts.category];
    if (opts.category === "popular") list = list.filter((v) => v.views >= 500_000);
  } else if (opts.category) {
    list = list.filter((v) => v.category === opts.category);
  }
  switch (sort) {
    case "newest":
      list = [...list].sort((a, b) => a.daysAgo - b.daysAgo);
      if (opts.category === "new") list = list.filter((v) => v.daysAgo <= 14);
      break;
    case "trending":
      list = [...list].sort((a, b) => trendingScore(b) - trendingScore(a));
      break;
    case "viewed":
    case "popular":
    default:
      list = [...list].sort((a, b) => b.views - a.views);
  }
  if (opts.limit) list = list.slice(0, opts.limit);
  await latency();
  return list;
}

export async function getVideo(idOrSlug: string): Promise<Video | undefined> {
  if (!DEMO_MODE) {
    const res = await fetch(`${API_BASE}/videos/${encodeURIComponent(idOrSlug)}`);
    if (res.ok) return (await res.json()) as Video;
  }
  await latency();
  return getCatalog().find((v) => v.id === idOrSlug || v.slug === idOrSlug);
}

export async function getRelated(video: Video, n = 12): Promise<Video[]> {
  const all = getCatalog().filter((v) => v.id !== video.id);
  const scored = all.map((v) => {
    let s = 0;
    if (v.category === video.category) s += 3;
    s += v.tags.filter((t) => video.tags.includes(t)).length;
    s += Math.min(2, v.views / 2_000_000);
    return { v, s };
  });
  await latency();
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.v);
}

export async function searchVideos(q: string): Promise<Video[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  if (!DEMO_MODE) {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
    if (res.ok) return (await res.json()) as Video[];
  }
  await latency();
  return getCatalog().filter((v) => {
    const hay = [v.title, v.performer, categoryName(v.category), ...v.tags, String(v.durationSec)]
      .join(" ")
      .toLowerCase();
    return query.split(/\s+/).every((w) => hay.includes(w));
  });
}

export function suggestionsFor(q: string, limit = 7): string[] {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  const pool = new Set<string>();
  for (const v of getCatalog()) {
    pool.add(v.title);
    pool.add(v.performer);
    v.tags.forEach((t) => pool.add(t));
  }
  getCategories().forEach((c) => pool.add(c.name));
  return [...pool].filter((s) => s.toLowerCase().includes(query)).slice(0, limit);
}

/* ---------------- counts / views ---------------- */

export function categoryName(slug: string): string {
  return getCategories().find((c) => c.slug === slug)?.name ?? slug;
}

export function countByCategory(slug: string): number {
  const all = getCatalog();
  if (slug === "trending") return all.filter((v) => v.trending).length;
  if (slug === "popular") return all.filter((v) => v.views >= 500_000).length;
  if (slug === "new") return all.filter((v) => v.daysAgo <= 14).length;
  return all.filter((v) => v.category === slug).length;
}

/** Record a real view event after a meaningful watch threshold. */
export async function recordView(videoId: string, seconds: number): Promise<void> {
  if (!getSettings().viewsEnabled) return;
  if (!DEMO_MODE) {
    try {
      await fetch(`${API_BASE}/views`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, seconds }),
      });
    } catch {
      /* network failure — drop event */
    }
    return;
  }
  recordLocalView(videoId, seconds);
}

export function ensureDemoSeed() {
  if (DEMO_MODE) seedDemoAnalytics(VIDEOS.map((v) => v.id));
}

export function eventCountFor(videoId: string): number {
  return getViewEvents().filter((e) => e.videoId === videoId).length;
}

/* ---------------- home feed ---------------- */

export interface HomeFeed {
  featured: Video | undefined;
  trending: Video[];
  popular: Video[];
  newest: Video[];
  mostWatched: Video[];
  editors: Video[];
}

export async function getHomeFeed(): Promise<HomeFeed> {
  const all = getCatalog();
  const byViews = [...all].sort((a, b) => b.views - a.views);
  const byTrending = [...all].sort((a, b) => trendingScore(b) - trendingScore(a));
  const byNew = [...all].sort((a, b) => a.daysAgo - b.daysAgo);
  await latency();
  return {
    featured: all.find((v) => v.featured) ?? byViews[0],
    trending: byTrending.slice(0, 10),
    popular: byViews.slice(0, 10),
    newest: byNew.slice(0, 10),
    mostWatched: byViews.slice(0, 10),
    editors: all.filter((v) => v.featured).concat(byNew).slice(0, 8),
  };
}

export { slugify };
export type { Video };
