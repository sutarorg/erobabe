import { useMemo, useRef } from "react";
import { VIDEOS, type Video } from "@/data/videos";
import { useHistory, useLikes, useSaved } from "@/hooks/store";

/* ──────────────────────────────────────────────────────────────
 * EroBabe recommendation engine.
 *
 * Two complementary surfaces are produced from one shared model:
 *
 *   Related      — "more like THIS video". Dominated by content
 *                  similarity to the video currently playing.
 *   Recommended  — "more like YOU". Dominated by a taste profile
 *                  built from watch history, likes and saves, then
 *                  blended with quality and momentum to maximise the
 *                  chance the viewer actually clicks.
 *
 * Design notes
 *  · Every signal is percentile-normalized, so one runaway video
 *    cannot flatten the rest of the catalog to zero.
 *  · Results are diversified with MMR, because four near-identical
 *    videos convert far worse than four good, distinct ones.
 *  · Already-watched titles are demoted, never hard-removed: with a
 *    small catalog a strict filter would empty the rails.
 *  · Everything degrades gracefully — a brand-new visitor with no
 *    history still gets quality/momentum-ranked results.
 * ────────────────────────────────────────────────────────────── */

/** Interaction weights — an explicit save says more than a passive view. */
const W_WATCH = 1;
const W_LIKE = 2.5;
const W_SAVE = 3;
/** Interest in a video halves roughly every two weeks. */
const HALF_LIFE_DAYS = 14;
/** Taste profile is considered fully formed at this many weighted signals. */
const PROFILE_MATURITY = 8;
/** How strongly repeated categories are suppressed within one rail. */
const MMR_DIVERSITY = 0.35;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "her", "his", "you", "your", "our", "she", "him",
  "that", "this", "from", "into", "was", "are", "get", "got", "not", "but",
  "out", "off", "own", "let", "all", "can", "cum", "me", "my", "in", "on",
  "of", "to", "a", "an", "is", "it", "at", "by", "up", "as", "so", "i",
]);

const tokenize = (text: string): string[] =>
  String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

/** Exponential recency decay for an interaction timestamp. */
const decay = (at: number) => Math.pow(0.5, (Date.now() - at) / 86_400_000 / HALF_LIFE_DAYS);

/** Percentile rank normalization — robust to outliers. */
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

const bump = (map: Map<string, number>, key: string | undefined | null, weight: number) => {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + weight);
};

/** Scale a weight map into 0..1 against its own maximum. */
function normalizeMap(map: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of map.values()) max = Math.max(max, v);
  if (max <= 0) return map;
  const out = new Map<string, number>();
  for (const [k, v] of map) out.set(k, v / max);
  return out;
}

export interface TasteProfile {
  categories: Map<string, number>;
  tags: Map<string, number>;
  performers: Map<string, number>;
  terms: Map<string, number>;
  watched: Set<string>;
  engaged: Set<string>;
  preferredDuration: number;
  /** 0..1 — how much interaction data backs this profile. */
  strength: number;
}

export const EMPTY_PROFILE: TasteProfile = {
  categories: new Map(),
  tags: new Map(),
  performers: new Map(),
  terms: new Map(),
  watched: new Set(),
  engaged: new Set(),
  preferredDuration: 0,
  strength: 0,
};

/** Build a weighted taste profile from the viewer's own activity. */
export function buildTasteProfile(
  interactions: { history: { id: string; at: number }[]; likes: string[]; saved: string[] },
  resolve: (id: string) => Video | undefined
): TasteProfile {
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();
  const performers = new Map<string, number>();
  const terms = new Map<string, number>();
  const watched = new Set<string>();
  const engaged = new Set<string>();

  let signal = 0;
  let durationSum = 0;
  let durationWeight = 0;

  const absorb = (video: Video | undefined, weight: number) => {
    if (!video || weight <= 0) return;
    signal += weight;
    bump(categories, video.category, weight);
    bump(performers, video.performer, weight);
    for (const tag of video.tags ?? []) bump(tags, tag.toLowerCase(), weight);
    for (const term of tokenize(video.title)) bump(terms, term, weight * 0.6);
    if (video.duration > 0) {
      durationSum += video.duration * weight;
      durationWeight += weight;
    }
  };

  for (const entry of interactions.history) {
    watched.add(entry.id);
    absorb(resolve(entry.id), W_WATCH * decay(entry.at));
  }
  for (const id of interactions.likes) {
    engaged.add(id);
    absorb(resolve(id), W_LIKE);
  }
  for (const id of interactions.saved) {
    engaged.add(id);
    absorb(resolve(id), W_SAVE);
  }

  return {
    categories: normalizeMap(categories),
    tags: normalizeMap(tags),
    performers: normalizeMap(performers),
    terms: normalizeMap(terms),
    watched,
    engaged,
    preferredDuration: durationWeight > 0 ? durationSum / durationWeight : 0,
    strength: Math.min(1, signal / PROFILE_MATURITY),
  };
}

/* ── similarity primitives ── */

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared++;
  return shared / (a.size + b.size - shared);
};

const lowerSet = (values: string[] | undefined) =>
  new Set((values ?? []).map((v) => v.toLowerCase()));

/** How closely `candidate` resembles `seed` in content terms (0..1). */
function contentSimilarity(seed: Video, candidate: Video): number {
  const categoryMatch = seed.category === candidate.category ? 1 : 0;
  const tagOverlap = jaccard(lowerSet(seed.tags), lowerSet(candidate.tags));
  const performerMatch = seed.performer && seed.performer === candidate.performer ? 1 : 0;
  const titleOverlap = jaccard(new Set(tokenize(seed.title)), new Set(tokenize(candidate.title)));
  const durationFit =
    seed.duration > 0 && candidate.duration > 0
      ? 1 - Math.min(1, Math.abs(seed.duration - candidate.duration) / Math.max(seed.duration, candidate.duration))
      : 0;

  return (
    categoryMatch * 0.34 +
    tagOverlap * 0.28 +
    titleOverlap * 0.18 +
    performerMatch * 0.12 +
    durationFit * 0.08
  );
}

/** How closely `candidate` matches the viewer's own taste (0..1). */
function tasteAffinity(profile: TasteProfile, candidate: Video): number {
  if (profile.strength <= 0) return 0;
  const category = profile.categories.get(candidate.category) ?? 0;

  let tagScore = 0;
  const tags = candidate.tags ?? [];
  for (const tag of tags) tagScore += profile.tags.get(tag.toLowerCase()) ?? 0;
  tagScore = tags.length ? tagScore / tags.length : 0;

  const performer = profile.performers.get(candidate.performer) ?? 0;

  const terms = tokenize(candidate.title);
  let termScore = 0;
  for (const term of terms) termScore += profile.terms.get(term) ?? 0;
  termScore = terms.length ? termScore / terms.length : 0;

  const durationFit =
    profile.preferredDuration > 0 && candidate.duration > 0
      ? 1 -
        Math.min(
          1,
          Math.abs(profile.preferredDuration - candidate.duration) /
            Math.max(profile.preferredDuration, candidate.duration)
        )
      : 0;

  return (
    category * 0.34 + tagScore * 0.3 + performer * 0.14 + termScore * 0.14 + durationFit * 0.08
  );
}

/* ── candidate scoring ── */

interface Scored {
  video: Video;
  score: number;
  similarity: number;
}

interface QualitySignals {
  quality: (v: Video) => number;
  popularity: (v: Video) => number;
  momentum: (v: Video) => number;
  recency: (v: Video) => number;
}

function qualitySignals(pool: Video[]): QualitySignals {
  const likeRate = (v: Video) => (v.views > 0 ? (v.likes ?? 0) / v.views : 0);
  const qN = percentile(pool.map(likeRate));
  const pN = percentile(pool.map((v) => Math.log10(1 + Math.max(v.views, 0))));
  const mN = percentile(pool.map((v) => v.score ?? 0));
  const rN = percentile(pool.map((v) => Math.exp(-Math.max(v.daysAgo, 0) / 21)));
  return {
    quality: (v) => qN(likeRate(v)),
    popularity: (v) => pN(Math.log10(1 + Math.max(v.views, 0))),
    momentum: (v) => mN(v.score ?? 0),
    recency: (v) => rN(Math.exp(-Math.max(v.daysAgo, 0) / 21)),
  };
}

/**
 * Maximal Marginal Relevance: greedily pick high scorers while
 * penalising candidates that duplicate an already-picked category or
 * performer, so a rail never becomes four versions of one video.
 */
function diversify(scored: Scored[], limit: number): Video[] {
  const picked: Video[] = [];
  const pool = [...scored].sort((a, b) => b.score - a.score);
  const seenCategory = new Map<string, number>();
  const seenPerformer = new Map<string, number>();

  while (picked.length < limit && pool.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const repeats =
        (seenCategory.get(c.video.category) ?? 0) + (seenPerformer.get(c.video.performer) ?? 0) * 0.5;
      const value = c.score - MMR_DIVERSITY * (repeats / (picked.length + 1));
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    const [chosen] = pool.splice(bestIndex, 1);
    picked.push(chosen.video);
    seenCategory.set(chosen.video.category, (seenCategory.get(chosen.video.category) ?? 0) + 1);
    seenPerformer.set(chosen.video.performer, (seenPerformer.get(chosen.video.performer) ?? 0) + 1);
  }
  return picked;
}

export interface Recommendations {
  related: Video[];
  recommended: Video[];
}

/**
 * Rank the catalog for the video being watched.
 *
 * `related` answers "more like this video"; `recommended` answers
 * "more like what you keep watching", with no overlap between them.
 */
export function computeRecommendations(
  seed: Video,
  catalog: Video[],
  profile: TasteProfile,
  { relatedCount = 4, recommendedCount = 20 } = {}
): Recommendations {
  const pool = catalog.filter((v) => v.id !== seed.id && v.uuid !== seed.uuid && Boolean(v.videoUrl));
  if (!pool.length) return { related: [], recommended: [] };

  const s = qualitySignals(pool);
  const simN = percentile(pool.map((v) => contentSimilarity(seed, v)));
  const tasteN = percentile(pool.map((v) => tasteAffinity(profile, v)));

  // Watched titles are demoted rather than removed, and the penalty
  // grows as the profile matures (established viewers want novelty).
  const seenPenalty = (v: Video) =>
    profile.watched.has(v.id) && !profile.engaged.has(v.id) ? 0.45 + 0.35 * profile.strength : 0;

  /* ── Related: similarity first ── */
  const relatedScored: Scored[] = pool.map((video) => {
    const similarity = simN(contentSimilarity(seed, video));
    const score =
      similarity * 0.52 +
      tasteN(tasteAffinity(profile, video)) * 0.14 * profile.strength +
      s.quality(video) * 0.13 +
      s.popularity(video) * 0.09 +
      s.momentum(video) * 0.07 +
      s.recency(video) * 0.05;
    return { video, similarity, score: score * (1 - seenPenalty(video)) };
  });
  const related = diversify(relatedScored, relatedCount);

  /* ── Recommended: personal taste first, no repeats from Related ── */
  const usedIds = new Set(related.map((v) => v.id));
  // Cold start: without a profile, lean on quality, momentum and reach.
  const tasteWeight = 0.2 + 0.38 * profile.strength;
  const discoveryWeight = 0.42 - 0.22 * profile.strength;

  const recommendedScored: Scored[] = pool
    .filter((v) => !usedIds.has(v.id))
    .map((video) => {
      const affinity = tasteN(tasteAffinity(profile, video));
      const discovery =
        s.momentum(video) * 0.4 + s.popularity(video) * 0.34 + s.recency(video) * 0.26;
      const score =
        affinity * tasteWeight +
        discovery * discoveryWeight +
        s.quality(video) * 0.22 +
        // A gentle nudge toward the current context keeps the page coherent.
        simN(contentSimilarity(seed, video)) * 0.16;
      return { video, similarity: affinity, score: score * (1 - seenPenalty(video)) };
    });

  const recommended = diversify(recommendedScored, recommendedCount);
  return { related, recommended };
}

/**
 * React binding: reads the viewer's local activity and returns both
 * rails. Results are frozen per video so the lists never reshuffle
 * underneath the viewer while a video is playing.
 */
export function useRecommendations(
  seed: Video | undefined,
  options?: { relatedCount?: number; recommendedCount?: number }
): Recommendations {
  const history = useHistory();
  const likes = useLikes();
  const saved = useSaved();

  // Latest activity without re-triggering the memo on every change.
  const live = useRef({ history: history.list, likes: likes.ids, saved: saved.ids });
  live.current = { history: history.list, likes: likes.ids, saved: saved.ids };

  const relatedCount = options?.relatedCount ?? 4;
  const recommendedCount = options?.recommendedCount ?? 20;

  return useMemo(() => {
    if (!seed) return { related: [], recommended: [] };
    const byId = new Map<string, Video>();
    for (const v of VIDEOS) {
      byId.set(v.id, v);
      if (v.uuid) byId.set(v.uuid, v);
    }
    const profile = buildTasteProfile(live.current, (id) => byId.get(id));
    return computeRecommendations(seed, VIDEOS, profile, { relatedCount, recommendedCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.id, relatedCount, recommendedCount]);
}
