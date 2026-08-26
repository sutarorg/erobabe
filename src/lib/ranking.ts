import type { Video } from "@/data/videos";

/**
 * Client-side mirror of the server ranking engine.
 *
 * The backend (server/ranking.mjs) scores videos from real analytics —
 * watch time, completion, unique viewers, acceleration. When no backend
 * is configured, or before the discovery response arrives, this module
 * derives the same four sections from the signals available locally so
 * the limits and ordering philosophy stay identical everywhere.
 */

export const SECTION_LIMITS = Object.freeze({
  featured: 5,
  trending: 8,
  rising: 3,
  editors: 5,
});

export interface DiscoverySections {
  featured: Video[];
  trending: Video[];
  rising: Video[];
  editors: Video[];
}

type SignalKey =
  | "popularity"
  | "recentViews"
  | "velocity"
  | "momentum"
  | "growth"
  | "quality"
  | "engagement"
  | "recency"
  | "ageAdjusted"
  | "uniqueness";

const WEIGHTS: Record<keyof DiscoverySections, Partial<Record<SignalKey, number>>> = {
  featured: { popularity: 0.18, recentViews: 0.2, engagement: 0.15, quality: 0.16, recency: 0.13, momentum: 0.12, uniqueness: 0.06 },
  trending: { recentViews: 0.3, velocity: 0.24, momentum: 0.18, engagement: 0.1, quality: 0.08, uniqueness: 0.06, popularity: 0.04 },
  rising: { momentum: 0.32, growth: 0.24, ageAdjusted: 0.16, quality: 0.12, engagement: 0.1, recency: 0.06 },
  editors: { quality: 0.28, engagement: 0.22, recentViews: 0.2, popularity: 0.16, recency: 0.14 },
};

const RISING_POPULARITY_PENALTY = 0.4;
const RISING_EXCLUDE_TOP_TRENDING = 3;

function percentile(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return (value: number) => {
    if (n <= 1) return n === 1 && sorted[0] > 0 ? 1 : 0;
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

function rawSignals(v: Video): Record<SignalKey, number> {
  const age = Math.max(v.daysAgo, 0);
  const views = Math.max(v.views, 0);
  const quality = (v.likeRatio ?? 0) / 100;
  // `score` is views decayed by age — a proxy for present-day pace.
  const pace = v.score ?? views / Math.pow(age + 2, 0.78);
  return {
    popularity: Math.log10(1 + views),
    recentViews: pace,
    velocity: pace / Math.max(age + 1, 1),
    momentum: pace / (Math.log2(age + 3) || 1),
    growth: views / Math.pow(age + 3, 1.15),
    quality,
    engagement: quality * Math.log10(1 + views),
    recency: Math.exp(-age / 21),
    ageAdjusted: views / Math.log2(age + 3),
    uniqueness: quality * 0.5 + Math.exp(-age / 45) * 0.5,
  };
}

function scoreAll(videos: Video[]) {
  const raws = videos.map(rawSignals);
  const keys = Object.keys(raws[0] ?? {}) as SignalKey[];
  const norms = {} as Record<SignalKey, (v: number) => number>;
  for (const k of keys) norms[k] = percentile(raws.map((r) => r[k]));
  return videos.map((video, i) => {
    const norm = {} as Record<SignalKey, number>;
    for (const k of keys) norm[k] = norms[k](raws[i][k]);
    return { video, norm };
  });
}

type Scored = ReturnType<typeof scoreAll>[number];

function takeTop(
  items: Scored[],
  weights: Partial<Record<SignalKey, number>>,
  limit: number,
  transform?: (base: number, item: Scored) => number
): Video[] {
  const scored = items.map((item) => {
    let base = 0;
    for (const [signal, weight] of Object.entries(weights)) {
      base += (item.norm[signal as SignalKey] ?? 0) * (weight ?? 0);
    }
    return { item, score: transform ? transform(base, item) : base };
  });
  scored.sort((a, b) => b.score - a.score || b.item.norm.recency - a.item.norm.recency);
  return scored.slice(0, limit).map((s) => s.item.video);
}

/** Rank a catalog into the four discovery sections, enforcing all limits. */
export function rankSections(videos: Video[]): DiscoverySections {
  const eligible = videos.filter((v) => Boolean(v.videoUrl));
  if (!eligible.length) return { featured: [], trending: [], rising: [], editors: [] };

  const items = scoreAll(eligible);
  const featured = takeTop(items, WEIGHTS.featured, SECTION_LIMITS.featured);
  const trending = takeTop(items, WEIGHTS.trending, SECTION_LIMITS.trending);

  const blocked = new Set(trending.slice(0, RISING_EXCLUDE_TOP_TRENDING).map((v) => v.id));
  const rising = takeTop(
    items.filter((i) => !blocked.has(i.video.id)),
    WEIGHTS.rising,
    SECTION_LIMITS.rising,
    (base, item) => base * (1 - RISING_POPULARITY_PENALTY * item.norm.popularity)
  );

  const editors = takeTop(
    items.filter((i) => i.video.editorsPick),
    WEIGHTS.editors,
    SECTION_LIMITS.editors
  );

  return { featured, trending, rising, editors };
}

/** Apply server-ranked id lists to the local catalog, preserving order + limits. */
export function sectionsFromIds(
  videos: Video[],
  ids: { featured: string[]; trending: string[]; rising: string[]; editors: string[] }
): DiscoverySections {
  const byId = new Map<string, Video>();
  for (const v of videos) {
    byId.set(v.id, v);
    if (v.uuid) byId.set(v.uuid, v);
  }
  const pick = (list: string[], limit: number) =>
    list.map((id) => byId.get(id)).filter((v): v is Video => Boolean(v)).slice(0, limit);
  return {
    featured: pick(ids.featured ?? [], SECTION_LIMITS.featured),
    trending: pick(ids.trending ?? [], SECTION_LIMITS.trending),
    rising: pick(ids.rising ?? [], SECTION_LIMITS.rising),
    editors: pick(ids.editors ?? [], SECTION_LIMITS.editors),
  };
}
