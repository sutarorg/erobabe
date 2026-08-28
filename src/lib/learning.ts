import { readStore, writeStore } from "@/hooks/store";

/* ──────────────────────────────────────────────────────────────
 * Self-learning ranking layer.
 *
 * The base recommender scores candidates with fixed weights. This
 * module makes those weights *adaptive*: every impression, click and
 * completed watch is fed back in, and the signals that actually
 * predict engagement for this specific viewer are amplified while the
 * ones that don't are damped.
 *
 * Two cooperating mechanisms:
 *
 *  1. Online weight learning — a lightweight logistic/perceptron-style
 *     update. Each recommendation records the normalized signal vector
 *     that produced it; when the outcome arrives (clicked / watched /
 *     skipped) the weights move along the error gradient.
 *
 *  2. Contextual bandit exploration — Thompson-style sampling over
 *     content facets (category, tag, duration bucket, time-of-day).
 *     Each facet keeps a Beta(α, β) posterior of "will this viewer
 *     engage?", so promising-but-unproven facets still get airtime
 *     instead of the model collapsing onto one narrow taste.
 *
 * Everything is per-browser (localStorage), privacy-preserving, bounded
 * in size, and degrades to the static model when no data exists.
 * ────────────────────────────────────────────────────────────── */

const MODEL_KEY = "eb:rank-model";
const PENDING_KEY = "eb:rank-pending";

/** Signals the learner can reweight. Mirrors the recommender's features. */
export type SignalKey =
  | "popularity" | "recentViews" | "velocity" | "momentum" | "growth"
  | "quality" | "engagement" | "recency" | "ageAdjusted" | "uniqueness"
  | "similarity" | "affinity";

export const SIGNAL_KEYS: SignalKey[] = [
  "popularity", "recentViews", "velocity", "momentum", "growth",
  "quality", "engagement", "recency", "ageAdjusted", "uniqueness",
  "similarity", "affinity",
];

/** Reward per outcome. Completion is the strongest signal of a good pick. */
const REWARD = {
  impression: 0,      // shown but not acted on → mild negative via baseline
  click: 0.45,
  watch: 0.7,         // meaningful watch time
  complete: 1,
  like: 1,
  save: 1,
  skip: -0.35,        // clicked then abandoned almost immediately
} as const;

export type Outcome = keyof typeof REWARD;

const LEARNING_RATE = 0.06;
/** Weights stay in this band so no single signal can dominate. */
const WEIGHT_MIN = 0.2;
const WEIGHT_MAX = 2.6;
/** Facet posteriors decay toward the prior so stale tastes fade. */
const FACET_DECAY = 0.995;
const MAX_FACETS = 300;
const MAX_PENDING = 120;

export interface FacetStat {
  /** Beta posterior — successes and failures, both smoothed. */
  a: number;
  b: number;
  at: number;
}

export interface RankModel {
  weights: Record<string, number>;
  facets: Record<string, FacetStat>;
  /** Running counts, used to fade exploration as confidence grows. */
  events: number;
  rewards: number;
  updatedAt: number;
}

const emptyModel = (): RankModel => ({
  weights: Object.fromEntries(SIGNAL_KEYS.map((k) => [k, 1])),
  facets: {},
  events: 0,
  rewards: 0,
  updatedAt: Date.now(),
});

export function loadModel(): RankModel {
  const stored = readStore<Partial<RankModel> | null>(MODEL_KEY, null);
  const base = emptyModel();
  if (!stored) return base;
  return {
    weights: { ...base.weights, ...(stored.weights ?? {}) },
    facets: stored.facets ?? {},
    events: stored.events ?? 0,
    rewards: stored.rewards ?? 0,
    updatedAt: stored.updatedAt ?? Date.now(),
  };
}

function saveModel(model: RankModel) {
  // Keep storage bounded: drop the least recently reinforced facets.
  const entries = Object.entries(model.facets);
  if (entries.length > MAX_FACETS) {
    entries.sort((x, y) => y[1].at - x[1].at);
    model.facets = Object.fromEntries(entries.slice(0, MAX_FACETS));
  }
  model.updatedAt = Date.now();
  writeStore(MODEL_KEY, model);
}

/* ── Facet helpers ── */

export const durationBucket = (seconds: number): string => {
  if (seconds <= 0) return "dur:unknown";
  if (seconds < 300) return "dur:short";
  if (seconds < 900) return "dur:mid";
  if (seconds < 1800) return "dur:long";
  return "dur:xlong";
};

export const dayPart = (at = new Date()): string => {
  const h = at.getHours();
  if (h < 6) return "time:night";
  if (h < 12) return "time:morning";
  if (h < 18) return "time:afternoon";
  return "time:evening";
};

/** Facets describing one video in the current context. */
export function facetsFor(video: {
  category?: string | null;
  tags?: string[];
  duration?: number;
}): string[] {
  const out: string[] = [dayPart()];
  if (video.category) out.push(`cat:${video.category}`);
  for (const tag of (video.tags ?? []).slice(0, 4)) out.push(`tag:${tag.toLowerCase()}`);
  out.push(durationBucket(video.duration ?? 0));
  return out;
}

/**
 * Thompson sampling from a facet's Beta posterior.
 * Returns roughly "probability this viewer engages", with genuine
 * uncertainty baked in so unexplored facets still surface.
 */
function sampleBeta(a: number, b: number): number {
  // Two gamma draws → Beta. Marsaglia-Tsang is overkill here; a simple
  // sum-of-uniforms approximation is smooth enough for ranking.
  const g = (k: number) => {
    let sum = 0;
    const n = Math.max(1, Math.min(12, Math.round(k * 2)));
    for (let i = 0; i < n; i++) sum += -Math.log(1 - Math.random());
    return sum * (k / n);
  };
  const x = g(Math.max(a, 0.1));
  const y = g(Math.max(b, 0.1));
  return x + y <= 0 ? 0.5 : x / (x + y);
}

/**
 * Exploration multiplier for a video, in roughly 0.75–1.35.
 * Facets the viewer reliably engages with lift the score; facets they
 * consistently skip damp it. Early on the spread is wide (exploration),
 * narrowing as evidence accumulates (exploitation).
 */
export function facetBoost(model: RankModel, facets: string[]): number {
  if (!facets.length) return 1;
  // Confidence ramps 0 → 1 over the first ~40 recorded events.
  const confidence = Math.min(1, model.events / 40);
  let total = 0;
  let count = 0;
  for (const facet of facets) {
    const stat = model.facets[facet];
    // Unseen facets sit at the optimistic prior, which is what drives
    // discovery of genuinely new content.
    const a = (stat?.a ?? 1) + 0.5;
    const b = (stat?.b ?? 1) + 0.5;
    total += sampleBeta(a, b);
    count += 1;
  }
  const mean = count ? total / count : 0.5;
  // Map 0..1 → 0.75..1.35, tightening around 1 while confidence is low.
  const spread = 0.3 * (0.45 + 0.55 * confidence);
  return 1 + (mean - 0.5) * 2 * spread;
}

/** Adaptive weight for one signal. */
export const weightFor = (model: RankModel, key: SignalKey): number =>
  model.weights[key] ?? 1;

/* ── Feedback ── */

interface PendingImpression {
  id: string;
  signals: Partial<Record<SignalKey, number>>;
  facets: string[];
  at: number;
}

const loadPending = (): PendingImpression[] => readStore<PendingImpression[]>(PENDING_KEY, []);
const savePending = (list: PendingImpression[]) =>
  writeStore(PENDING_KEY, list.slice(-MAX_PENDING));

/**
 * Record that a video was recommended, along with the signal vector that
 * produced it. Held until an outcome arrives so the update can be
 * attributed to the right features.
 */
export function recordImpression(
  id: string,
  signals: Partial<Record<SignalKey, number>>,
  facets: string[]
) {
  if (!id) return;
  const pending = loadPending().filter((p) => p.id !== id);
  pending.push({ id, signals, facets, at: Date.now() });
  savePending(pending);
}

/**
 * Apply an observed outcome. Moves signal weights along the error
 * gradient and updates the facet posteriors.
 */
export function recordOutcome(id: string, outcome: Outcome) {
  if (!id) return;
  const pending = loadPending();
  const entry = pending.find((p) => p.id === id);
  const model = loadModel();
  const reward = REWARD[outcome];

  // Facet posteriors update even without a matching impression, since
  // likes/saves can happen anywhere in the app.
  const facets = entry?.facets ?? [];
  for (const facet of facets) {
    const stat = model.facets[facet] ?? { a: 1, b: 1, at: Date.now() };
    // Decay first so old evidence gently loses influence.
    stat.a = 1 + (stat.a - 1) * FACET_DECAY;
    stat.b = 1 + (stat.b - 1) * FACET_DECAY;
    if (reward > 0) stat.a += reward;
    else stat.b += Math.abs(reward) + 0.15;
    stat.at = Date.now();
    model.facets[facet] = stat;
  }

  if (entry) {
    /*
     * Perceptron-style update. `predicted` is how strongly the model
     * expected engagement (its own normalized score); the error is the
     * gap to the realised reward. Signals that were high on a winning
     * recommendation get reinforced, and vice versa.
     */
    const signals = entry.signals;
    let predicted = 0;
    let mass = 0;
    for (const key of SIGNAL_KEYS) {
      const value = signals[key];
      if (value == null) continue;
      predicted += value * weightFor(model, key);
      mass += weightFor(model, key);
    }
    predicted = mass > 0 ? predicted / mass : 0.5;
    const target = reward > 0 ? 1 : 0;
    const error = target - predicted;

    for (const key of SIGNAL_KEYS) {
      const value = signals[key];
      if (value == null) continue;
      // Centre the feature so mid-range values don't drag weights around.
      const centred = value - 0.5;
      const next = weightFor(model, key) + LEARNING_RATE * error * centred * 2;
      model.weights[key] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, next));
    }

    savePending(pending.filter((p) => p.id !== id));
  }

  model.events += 1;
  model.rewards += reward;
  saveModel(model);
}

/** Diagnostics for the admin/debug surface. */
export function modelSummary() {
  const model = loadModel();
  const top = Object.entries(model.weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => ({ signal: k, weight: Number(v.toFixed(2)) }));
  return {
    events: model.events,
    avgReward: model.events ? model.rewards / model.events : 0,
    trackedFacets: Object.keys(model.facets).length,
    topSignals: top,
  };
}

/** Wipe learned state (used by the privacy control). */
export function resetModel() {
  writeStore(MODEL_KEY, emptyModel());
  writeStore(PENDING_KEY, []);
}
