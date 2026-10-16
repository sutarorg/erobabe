export const ALGORITHM_VERSION = "erobabe-rec-v1";

export const RECOMMENDATION_WEIGHTS = {
  recommended: { personalPreference: 0.28, contextRelevance: 0.18, playbackSatisfaction: 0.17, explicitPositive: 0.12, freshness: 0.08, qualityConfidence: 0.07, novelty: 0.10 },
  up_next: { personalPreference: 0.14, contextRelevance: 0.40, playbackSatisfaction: 0.12, explicitPositive: 0.08, freshness: 0.08, qualityConfidence: 0.06, novelty: 0.12 },
  featured: { personalPreference: 0.10, contextRelevance: 0.12, playbackSatisfaction: 0.08, explicitPositive: 0.08, freshness: 0.20, qualityConfidence: 0.26, novelty: 0.16 },
} as const;

export type RecommendationSurface = "home" | "up_next" | "recommended" | "featured" | "most_liked";

export type RecommendationCandidate = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  quality?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  published_at?: string | null;
  category_id?: string | null;
  category_label?: string | null;
  category_slug?: string | null;
  tag_slugs?: string[];
};

export type ScoringContext = {
  surface: RecommendationSurface;
  now?: number;
  current?: RecommendationCandidate | null;
  preferredCategoryIds?: ReadonlySet<string>;
  suppressedCategoryIds?: ReadonlySet<string>;
  interestedVideoIds?: ReadonlySet<string>;
  rejectedVideoIds?: ReadonlySet<string>;
  lessLikeCategoryIds?: ReadonlySet<string>;
  satisfiedCategoryIds?: ReadonlySet<string>;
  exposedVideoIds?: ReadonlySet<string>;
  watchedVideoIds?: ReadonlySet<string>;
  editorialVideoIds?: ReadonlySet<string>;
  limit?: number;
};

export type FeedCursor = { date: string; id: string };
export function isAfterRankCursor(item: { score: number; id: string }, cursor?: FeedCursor) {
  if (!cursor) return true;
  const score = Number(cursor.date);
  return item.score < score || (item.score === score && item.id.localeCompare(cursor.id) > 0);
}
export function isAfterLikeCursor(item: { like_count?: number | null; id: string }, cursor?: FeedCursor) {
  if (!cursor) return true;
  const count = Number(cursor.date);
  const likes = Number(item.like_count) || 0;
  return likes < count || (likes === count && item.id.localeCompare(cursor.id) > 0);
}
export function isAfterLatestCursor(item: { published_at?: string | null; id: string }, cursor?: FeedCursor) {
  if (!cursor) return true;
  const date = item.published_at || "";
  return date < cursor.date || (date === cursor.date && item.id.localeCompare(cursor.id) < 0);
}

export type RankedCandidate = RecommendationCandidate & {
  score: number;
  reason: string;
  features: {
    personalPreference: number;
    contextRelevance: number;
    playbackSatisfaction: number;
    explicitPositive: number;
    freshness: number;
    qualityConfidence: number;
    novelty: number;
  };
};

const DAY_MS = 86_400_000;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const tokens = (value: string) => new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((part) => part.length > 2) || []);

function metadataSimilarity(a: RecommendationCandidate, b: RecommendationCandidate): number {
  const left = tokens(`${a.title} ${a.description || ""}`);
  const right = tokens(`${b.title} ${b.description || ""}`);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const lexical = intersection / (left.size + right.size - intersection);
  const tags = new Set(a.tag_slugs || []);
  const tagOverlap = (b.tag_slugs || []).filter((tag) => tags.has(tag)).length;
  return clamp01(Math.max(lexical, tagOverlap ? tagOverlap / Math.max(tags.size, (b.tag_slugs || []).length, 1) : 0));
}

function candidateFeatures(candidate: RecommendationCandidate, context: ScoringContext) {
  const now = context.now ?? Date.now();
  const ageMs = candidate.published_at ? Math.max(0, now - Date.parse(candidate.published_at)) : Number.POSITIVE_INFINITY;
  const freshness = Number.isFinite(ageMs) ? Math.exp(-ageMs / (21 * DAY_MS)) : 0;
  const preferred = context.preferredCategoryIds?.has(candidate.category_id || "") ? 1 : 0;
  const contextRelevance = context.current
    ? candidate.category_id && candidate.category_id === context.current.category_id
      ? 1
      : metadataSimilarity(candidate, context.current)
    : 0;
  const playbackSatisfaction = context.satisfiedCategoryIds?.has(candidate.category_id || "") ? 1 : 0;
  const explicitPositive = context.interestedVideoIds?.has(candidate.id) ? 1 : 0;
  const viewConfidence = Math.log1p(Math.max(0, Number(candidate.view_count) || 0)) / Math.log1p(10_000);
  const likeConfidence = Math.log1p(Math.max(0, Number(candidate.like_count) || 0)) / Math.log1p(250);
  const qualityConfidence = clamp01((candidate.quality ? 0.55 + (candidate.quality === "4K" ? 0.2 : 0.1) : 0.25) + 0.25 * Math.max(viewConfidence, likeConfidence));
  const novelty = context.exposedVideoIds?.has(candidate.id) ? 0 : clamp01(0.75 * (1 - viewConfidence) + 0.25 * freshness);
  const personalPreference = preferred;
  const features = { personalPreference, contextRelevance, playbackSatisfaction, explicitPositive, freshness, qualityConfidence, novelty };
  const weights = context.surface === "featured" ? RECOMMENDATION_WEIGHTS.featured : context.surface === "up_next" ? RECOMMENDATION_WEIGHTS.up_next : RECOMMENDATION_WEIGHTS.recommended;
  const score = Object.entries(weights).reduce((sum, [key, weight]) => sum + features[key as keyof typeof features] * weight, 0);
  return { features, score };
}

/**
 * Deterministic feature ranker followed by a greedy MMR-like category/title
 * fatigue penalty. Suppression is a hard rule and never a weighted signal.
 */
export function rankCandidates(
  candidates: RecommendationCandidate[],
  context: ScoringContext,
): RankedCandidate[] {
  const unique = new Map<string, RecommendationCandidate>();
  for (const item of candidates) {
    if (!item?.id || !item.slug || !item.title) continue;
    if (context.current?.id === item.id) continue;
    if (context.rejectedVideoIds?.has(item.id)) continue;
    if (context.suppressedCategoryIds?.has(item.category_id || "")) continue;
    unique.set(item.id, item);
  }

  const base = [...unique.values()].map((item) => {
    const { features, score } = candidateFeatures(item, context);
    const editorialBoost = context.surface === "featured" && context.editorialVideoIds?.has(item.id) ? 0.2 : 0;
    const fatigue = context.watchedVideoIds?.has(item.id) ? 0.25 : 0;
    const negativePreference = context.lessLikeCategoryIds?.has(item.category_id || "") ? 0.18 : 0;
    const adjusted = clamp01(score + editorialBoost - fatigue - negativePreference);
    const reason = context.surface === "up_next" && features.contextRelevance > 0.5
      ? "Related to this video"
      : features.explicitPositive > 0
        ? "You marked this as interesting"
        : features.personalPreference > 0
          ? "Matches a category you chose"
          : features.freshness > 0.7
            ? "Recently published"
            : features.qualityConfidence > 0.65
              ? "Popular with viewers"
              : "A fresh discovery";
    return { ...item, score: adjusted, reason, features };
  }).sort((a, b) => b.score - a.score || (b.published_at || "").localeCompare(a.published_at || "") || a.id.localeCompare(b.id));

  const chosen: RankedCandidate[] = [];
  const remaining = [...base];
  const target = Math.max(1, Math.min(context.limit ?? 16, 40));
  while (remaining.length && chosen.length < target) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const item = remaining[i];
      const sameCategory = item.category_id && chosen.filter((prev) => prev.category_id === item.category_id).length;
      const maxSimilarity = chosen.reduce((max, prev) => Math.max(max, metadataSimilarity(item, prev)), 0);
      const repeatedExposure = context.exposedVideoIds?.has(item.id) ? 0.16 : 0;
      const marginal = item.score - Math.min(0.26, Number(sameCategory || 0) * 0.075) - maxSimilarity * 0.12 - repeatedExposure;
      if (marginal > bestValue) { bestValue = marginal; bestIndex = i; }
    }
    const selected = remaining.splice(bestIndex, 1)[0];
    chosen.push(selected);
  }
  return chosen;
}

/** Wilson lower bound is intentionally not used: this app stores positive likes,
 * not impression-level positives and negatives. This is a normalized count only. */
export function mostLikedScore(likeCount: number | null | undefined): number {
  return Math.log1p(Math.max(0, Number(likeCount) || 0));
}
