import { dbApi, hasColumn } from "./db.mjs";

/* ──────────────────────────────────────────────────────────────
 * EroBabe discovery ranking engine.
 *
 * One centralized, analytics-driven scoring service that decides
 * which videos appear in Featured / Trending / Rising Now /
 * Editor's Pick — and in what order.
 *
 * Design goals
 *  · Current performance, quality and momentum beat lifetime views.
 *  · Historically huge videos cannot permanently occupy every slot
 *    (popularity is log-damped, percentile-normalized and, for the
 *    momentum sections, actively penalized).
 *  · Every signal is optional: whatever analytics exist are used,
 *    missing ones simply drop out of the weighted average.
 *  · Weights live in SECTION_WEIGHTS so the model can be tuned
 *    later without touching any UI code.
 * ────────────────────────────────────────────────────────────── */

/** Hard caps — never exceeded regardless of how many videos qualify. */
export const SECTION_LIMITS = Object.freeze({
  featured: 5,
  trending: 8,
  rising: 3,
  editors: 5,
});

const WINDOW_DAYS = 30;
const CACHE_MS = 60_000;

/**
 * Signal weights per section. Each key maps to a normalized 0..1 signal.
 * Tune here; every discovery surface picks the change up automatically.
 */
const SECTION_WEIGHTS = Object.freeze({
  // Balanced blend: proven popularity + present-day performance + quality.
  featured: {
    popularity: 0.18,
    recentViews: 0.2,
    engagement: 0.15,
    quality: 0.16,
    recency: 0.13,
    momentum: 0.12,
    uniqueness: 0.06,
  },
  // Momentum first: what is being watched right now.
  trending: {
    recentViews: 0.3,
    velocity: 0.24,
    momentum: 0.18,
    engagement: 0.1,
    quality: 0.08,
    uniqueness: 0.06,
    popularity: 0.04,
  },
  // Acceleration and performance relative to age.
  rising: {
    momentum: 0.32,
    growth: 0.24,
    ageAdjusted: 0.16,
    quality: 0.12,
    engagement: 0.1,
    recency: 0.06,
  },
  // Curated pool, ranked on quality and real audience response.
  editors: {
    quality: 0.28,
    engagement: 0.22,
    recentViews: 0.2,
    popularity: 0.16,
    recency: 0.14,
  },
});

/** Rising Now should surface newcomers, so damp already-massive videos hard. */
const RISING_POPULARITY_PENALTY = 0.4;
/** Keep Rising Now visibly distinct from the top of Trending. */
const RISING_EXCLUDE_TOP_TRENDING = 3;

const utcDay = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (iso) => {
  if (!iso) return 999;
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, ms / 86_400_000) : 999;
};

/**
 * Percentile rank normalization (0..1), robust against outliers:
 * one viral video cannot flatten the rest of the catalog to zero.
 */
function percentileNormalizer(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return (value) => {
    if (n <= 1) return sorted.length === 1 && sorted[0] > 0 ? 1 : 0;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo / (n - 1);
  };
}

/** Collect raw per-video metrics from the published catalog + event log. */
async function collectMetrics() {
  const [hasWatch, hasLikes, hasSlug] = await Promise.all([
    hasColumn("analytics_events", "watch_seconds"),
    hasColumn("videos", "likes"),
    hasColumn("videos", "slug"),
  ]);

  const videoCols = [
    "id", "title", "views", "like_ratio", "duration_s",
    "published_at", "created_at", "editors_pick", "video_url", "hls_url",
    hasLikes ? "likes" : null,
    hasSlug ? "slug" : null,
  ].filter(Boolean).join(",");

  const eventCols = [
    "video_id", "created_day", "viewer_hash",
    hasWatch ? "watch_seconds" : null,
    hasWatch ? "completion" : null,
  ].filter(Boolean).join(",");

  const [videosRes, eventsRes] = await Promise.all([
    dbApi.select("videos", `status=eq.published&select=${videoCols}&limit=5000`),
    dbApi
      .select("analytics_events", `created_day=gte.${utcDay(WINDOW_DAYS - 1)}&select=${eventCols}&limit=200000`)
      .catch(() => ({ data: [] })),
  ]);

  // Eligibility: published AND actually playable.
  const videos = videosRes.data.filter((v) => v.video_url || v.hls_url);
  const eligible = new Set(videos.map((v) => v.id));

  const d1 = utcDay(0);
  const d3 = utcDay(2);
  const d7 = utcDay(6);
  const d14 = utcDay(13);

  const agg = new Map();
  const bucket = () => ({
    v1: 0, v3: 0, v7: 0, v14: 0, v30: 0,
    viewers: new Set(), watch: 0, completionSum: 0, completionCount: 0,
  });

  for (const e of eventsRes.data) {
    if (!eligible.has(e.video_id)) continue;
    let a = agg.get(e.video_id);
    if (!a) agg.set(e.video_id, (a = bucket()));
    const day = e.created_day;
    a.v30 += 1;
    if (day >= d14) a.v14 += 1;
    if (day >= d7) a.v7 += 1;
    if (day >= d3) a.v3 += 1;
    if (day >= d1) a.v1 += 1;
    a.viewers.add(e.viewer_hash);
    if (hasWatch) {
      a.watch += e.watch_seconds ?? 0;
      if ((e.completion ?? 0) > 0) {
        a.completionSum += e.completion;
        a.completionCount += 1;
      }
    }
  }

  return videos.map((v) => {
    const a = agg.get(v.id) ?? bucket();
    const ageDays = daysBetween(v.published_at || v.created_at);
    const lifetime = Math.max(v.views ?? 0, 0);
    const duration = Math.max(v.duration_s ?? 0, 0);
    const sessions = a.v30;

    // Recent pace vs. the preceding stretch → acceleration.
    const recentPace = a.v3 / 3;
    const priorPace = Math.max(a.v14 - a.v3, 0) / 11;
    const acceleration = recentPace / (priorPace + 0.35);
    const growth = a.v7 / (Math.max(a.v30 - a.v7, 0) / 3 + 0.5);

    const avgWatch = sessions > 0 ? a.watch / sessions : 0;
    const completion =
      a.completionCount > 0
        ? a.completionSum / a.completionCount / 100
        : duration > 0 && avgWatch > 0
          ? Math.min(avgWatch / duration, 1)
          : 0;

    // Quality: real completion when tracked, else the like ratio as a proxy.
    const quality = completion > 0 ? completion : (v.like_ratio ?? 0) / 100;
    const likes = v.likes ?? 0;
    const engagement =
      lifetime > 0 ? (likes > 0 ? likes / lifetime : 0) + (v.like_ratio ?? 0) / 1000 : 0;

    return {
      id: v.id,
      slug: v.slug ?? null,
      editorsPick: !!v.editors_pick,
      raw: {
        recentViews: a.v7,
        velocity: a.v3 / 3,
        momentum: acceleration,
        growth,
        uniqueness: sessions > 0 ? a.viewers.size / sessions : 0,
        quality,
        engagement,
        popularity: Math.log10(1 + lifetime),
        recency: Math.exp(-ageDays / 21),
        ageAdjusted: a.v7 / Math.log2(ageDays + 3),
      },
    };
  });
}

/** Normalize every raw signal across the eligible set. */
function normalize(items) {
  if (!items.length) return items;
  const keys = Object.keys(items[0].raw);
  const normalizers = {};
  for (const k of keys) normalizers[k] = percentileNormalizer(items.map((i) => i.raw[k]));
  for (const item of items) {
    item.norm = {};
    for (const k of keys) item.norm[k] = normalizers[k](item.raw[k]);
  }
  return items;
}

const scoreFor = (item, weights) => {
  let score = 0;
  for (const [signal, weight] of Object.entries(weights)) score += (item.norm[signal] ?? 0) * weight;
  return score;
};

const takeTop = (items, weights, limit, transform) => {
  const scored = items.map((item) => {
    const base = scoreFor(item, weights);
    return { item, score: transform ? transform(base, item) : base };
  });
  scored.sort((a, b) => b.score - a.score || b.item.norm.recency - a.item.norm.recency);
  return scored.slice(0, limit).map((s) => s.item);
};

let cache = { at: 0, data: null };

/** Rank the catalog and return the id list for every discovery section. */
export async function computeDiscovery({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  const items = normalize(await collectMetrics());

  const featured = takeTop(items, SECTION_WEIGHTS.featured, SECTION_LIMITS.featured);
  const trending = takeTop(items, SECTION_WEIGHTS.trending, SECTION_LIMITS.trending);

  // Rising Now: newcomers with real acceleration, kept distinct from the
  // very top of Trending so the two sections never mirror each other.
  const blocked = new Set(trending.slice(0, RISING_EXCLUDE_TOP_TRENDING).map((i) => i.id));
  const rising = takeTop(
    items.filter((i) => !blocked.has(i.id)),
    SECTION_WEIGHTS.rising,
    SECTION_LIMITS.rising,
    (base, item) => base * (1 - RISING_POPULARITY_PENALTY * item.norm.popularity)
  );

  // Editor's Pick: admins define the candidate pool, the engine ranks it.
  const editors = takeTop(
    items.filter((i) => i.editorsPick),
    SECTION_WEIGHTS.editors,
    SECTION_LIMITS.editors
  );

  const ref = (i) => i.slug || i.id;
  const data = {
    featured: featured.map(ref),
    trending: trending.map(ref),
    rising: rising.map(ref),
    editors: editors.map(ref),
    limits: SECTION_LIMITS,
    eligible: items.length,
    generatedAt: new Date().toISOString(),
  };

  cache = { at: Date.now(), data };
  return data;
}

/** Called whenever new analytics arrive so the next read is recomputed. */
export function invalidateDiscovery() {
  cache = { at: 0, data: null };
}
