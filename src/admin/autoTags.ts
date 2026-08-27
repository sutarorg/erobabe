/* ──────────────────────────────────────────────────────────────
 * Automatic tag generation.
 *
 * Reads the video's title and description, extracts meaningful
 * keywords, then scores every candidate against what is currently
 * trending in the live catalog. The top 5 are written straight into
 * the Tags field — the admin can still edit or remove them.
 *
 * Scoring blends three things:
 *   · Relevance  — does the phrase actually appear in the title or
 *                  description, and how prominently?
 *   · Trend      — how popular is that tag across the catalog right
 *                  now, weighted toward recently published videos?
 *   · Vocabulary — prefer terms already used as tags elsewhere, so
 *                  the taxonomy stays consistent instead of sprawling.
 * ────────────────────────────────────────────────────────────── */

/** Words that carry no descriptive value as a tag. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "her", "his", "you", "your", "our", "she", "him",
  "they", "them", "that", "this", "from", "into", "was", "were", "are", "get",
  "got", "not", "but", "out", "off", "own", "let", "all", "can", "has", "have",
  "had", "how", "why", "who", "what", "when", "where", "just", "very", "more",
  "most", "some", "any", "own", "than", "then", "too", "its", "it's", "video",
  "watch", "full", "new", "hot", "best", "free", "online", "hd", "part", "scene",
  "clip", "here", "there", "about", "after", "before", "while", "over", "under",
  "again", "once", "only", "also", "much", "many", "does", "did", "doing",
  "will", "would", "could", "should", "make", "makes", "made", "like", "want",
  "wants", "going", "goes", "gets", "let's", "lets", "she's", "he's",
]);

/** Multi-word phrases worth recognising as a single tag. */
const PHRASES = [
  "point of view", "behind the scenes", "slow motion", "first time",
  "close up", "role play", "girl next door", "date night", "late night",
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Title Case for display, preserving short connector words. */
function titleCase(input: string): string {
  const minor = new Set(["of", "in", "on", "the", "and", "a", "an", "to"]);
  return input
    .split(" ")
    .map((w, i) =>
      i > 0 && minor.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
}

const tokenize = (text: string): string[] =>
  norm(text)
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

export interface TrendingTag {
  /** Lowercased tag text. */
  key: string;
  /** Display form, as it appears in the catalog. */
  label: string;
  /** 0–1 trend strength. */
  trend: number;
}

export interface TagSourceVideo {
  tags?: string[];
  daysAgo?: number;
  views?: number;
  score?: number;
}

/**
 * Rank the catalog's existing tags by current momentum. Recent, high
 * performing videos push their tags up the list.
 */
export function buildTrendingTags(videos: TagSourceVideo[]): TrendingTag[] {
  const weights = new Map<string, { label: string; weight: number }>();
  let max = 0;

  for (const v of videos) {
    const age = Math.max(v.daysAgo ?? 0, 0);
    // Recency decay (~3 week half-life) plus a gentle reach bonus.
    const recency = Math.pow(0.5, age / 21);
    const reach = Math.log10(1 + Math.max(v.views ?? 0, 0)) / 7;
    const weight = recency * 0.7 + Math.min(reach, 1) * 0.3;

    for (const raw of v.tags ?? []) {
      const label = String(raw).trim();
      if (!label) continue;
      const key = norm(label);
      const entry = weights.get(key) ?? { label, weight: 0 };
      entry.weight += weight;
      weights.set(key, entry);
      max = Math.max(max, entry.weight);
    }
  }

  return [...weights.entries()]
    .map(([key, { label, weight }]) => ({
      key,
      label,
      trend: max > 0 ? weight / max : 0,
    }))
    .sort((a, b) => b.trend - a.trend);
}

interface Candidate {
  key: string;
  label: string;
  score: number;
}

/**
 * Generate the top tags for a video from its title and description.
 *
 * @param title        Video title (weighted most heavily).
 * @param description  Video description.
 * @param trending     Catalog tags ranked by momentum.
 * @param categoryName Optional category, always considered.
 * @param limit        How many tags to return.
 */
export function generateTags(
  title: string,
  description: string,
  trending: TrendingTag[],
  categoryName?: string | null,
  limit = 5
): string[] {
  const titleText = norm(title);
  const descText = norm(description);
  const haystack = `${titleText} ${descText}`;
  if (!haystack.trim() && !categoryName) return [];

  const trendMap = new Map(trending.map((t) => [t.key, t]));
  const candidates = new Map<string, Candidate>();

  const add = (label: string, score: number) => {
    const key = norm(label);
    if (!key || key.length < 3 || STOPWORDS.has(key)) return;
    const existing = candidates.get(key);
    const trend = trendMap.get(key);
    // A tag the catalog already uses keeps its canonical spelling.
    const display = trend?.label ?? label;
    if (existing) {
      existing.score = Math.max(existing.score, score);
      existing.label = trend?.label ?? existing.label;
    } else {
      candidates.set(key, { key, label: display, score });
    }
  };

  /* 1. Existing catalog tags that literally appear in the text — the
        strongest signal, since they are both relevant and known. */
  for (const t of trending) {
    if (haystack.includes(t.key)) {
      const inTitle = titleText.includes(t.key);
      add(t.label, (inTitle ? 1.0 : 0.72) + t.trend * 0.6);
    }
  }

  /* 2. Known multi-word phrases. */
  for (const phrase of PHRASES) {
    if (haystack.includes(phrase)) {
      const inTitle = titleText.includes(phrase);
      add(titleCase(phrase), (inTitle ? 0.85 : 0.6) + (trendMap.get(phrase)?.trend ?? 0) * 0.5);
    }
  }

  /* 3. Salient single words, scored by where and how often they occur. */
  const titleTokens = tokenize(title);
  const descTokens = tokenize(description);
  const freq = new Map<string, number>();
  for (const w of descTokens) freq.set(w, (freq.get(w) ?? 0) + 1);

  for (const w of new Set(titleTokens)) {
    const trend = trendMap.get(w)?.trend ?? 0;
    // Title words are the most descriptive thing we have.
    add(trendMap.get(w)?.label ?? titleCase(w), 0.62 + trend * 0.5 + Math.min(freq.get(w) ?? 0, 3) * 0.04);
  }
  for (const [w, count] of freq) {
    if (titleTokens.includes(w)) continue;
    const trend = trendMap.get(w)?.trend ?? 0;
    // Description-only words need repetition or catalog backing to qualify.
    const score = 0.3 + Math.min(count, 4) * 0.07 + trend * 0.55;
    if (score >= 0.42 || trend > 0.25) add(trendMap.get(w)?.label ?? titleCase(w), score);
  }

  /* 4. Two-word title pairs often make better tags than either word. */
  for (let i = 0; i < titleTokens.length - 1; i++) {
    const pair = `${titleTokens[i]} ${titleTokens[i + 1]}`;
    const trend = trendMap.get(pair)?.trend;
    if (trend !== undefined) add(trendMap.get(pair)!.label, 0.95 + trend * 0.6);
  }

  /* 5. The category is always a reasonable tag. */
  if (categoryName) add(categoryName, 0.58 + (trendMap.get(norm(categoryName))?.trend ?? 0) * 0.4);

  /* 6. Top up with pure trending tags if the text was too thin. */
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  if (ranked.length < limit) {
    for (const t of trending) {
      if (ranked.length >= limit) break;
      if (candidates.has(t.key)) continue;
      candidates.set(t.key, { key: t.key, label: t.label, score: t.trend * 0.3 });
      ranked.push({ key: t.key, label: t.label, score: t.trend * 0.3 });
    }
    ranked.sort((a, b) => b.score - a.score);
  }

  // Drop near-duplicates ("Studio" vs "Studio Cut") to keep 5 distinct tags.
  const chosen: string[] = [];
  const usedKeys: string[] = [];
  for (const c of ranked) {
    if (chosen.length >= limit) break;
    if (usedKeys.some((k) => k.includes(c.key) || c.key.includes(k))) continue;
    usedKeys.push(c.key);
    chosen.push(c.label.length > 24 ? c.label.slice(0, 24).trim() : c.label);
  }
  return chosen;
}
