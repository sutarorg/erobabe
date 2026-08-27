import { formatDuration, formatViews, timeAgo } from "@/lib/format";
import { rankSections, sectionsFromIds, type DiscoverySections } from "@/lib/ranking";

/**
 * ─────────────────────────────────────────────────────────────
 * EroBabe demo dataset.
 *
 * EVERYTHING here is fictional UI-demo content: invented titles,
 * invented performer names, tasteful stock thumbnails and openly
 * licensed placeholder video files. Swap `thumbnail` / `videoUrl`
 * with your own media (e.g. /assets/thumbnails/thumb-01.jpg and
 * /assets/videos/video-01.mp4) without touching any component.
 * ─────────────────────────────────────────────────────────────
 */

export type CategorySlug =
  | "amateur" | "hardcore" | "young-18" | "masturbation" | "lesbian" | "threesome"
  | "ebony" | "creampie" | "asian" | "massage" | "blonde";

export interface Video {
  /** Routing key — the SEO slug for CMS videos (`/video/{slug}`). */
  id: string;
  /** Database uuid when the video comes from the CMS (used for view tracking). */
  uuid?: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  title: string;
  category: CategorySlug;
  duration: number; // seconds
  durationLabel: string;
  views: number;
  viewsLabel: string;
  daysAgo: number;
  dateLabel: string;
  likeRatio: number; // 0–100
  thumbnail: string;
  videoUrl: string;
  tags: string[];
  performer: string;
  description: string;
  featured?: boolean;
  trending?: boolean;
  hot?: boolean;
  isNew?: boolean;
  editorsPick?: boolean;
  score: number; // internal trend score
}

export interface Category {
  slug: string;
  name: string;
  blurb: string;
  image: string;
  gradient: string;
  /** Icon key from the shared registry (src/lib/categoryIcons.ts). */
  icon?: string;
  href?: string;
}

/* ── Placeholder thumbnails (tasteful, cinematic stock photography) ── */
const P = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`;

export const THUMBS = {
  satinBlack: P(6843237),
  silkPurple: P(36095039),
  velvetRed: P(6843283),
  satinRedBlue: P(36095048),
  satinIridescent: P(38422741),
  satinRipples: P(36095038),
  neonCorridor: P(32260697),
  neonPhone: P(19665186),
  neonRedGlow: P(36806859),
  furRedNight: P(16077169),
  suitNight: P(14096150),
  neonBlue: P(8271461),
  danceTwilight: P(27700168),
  corridorPair: P(18546264),
  kissMotion: P(32236360),
  streetCouple: P(9676247),
  candleSleep: P(9663182),
  candlesSoft: P(37368064),
  candleDark: P(10699340),
  candleGlass: P(35710028),
  candleBedside: P(6514239),
} as const;

export const HERO_IMAGE = "/assets/hero.jpg";

/** Flat list used for deterministic thumbnail assignment. */
const THUMB_LIST = Object.values(THUMBS);

/* ── Placeholder demo video files (openly licensed samples) ── */
const G = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample";
export const DEMO_SOURCES = [
  `${G}/Sintel.mp4`,
  `${G}/TearsOfSteel.mp4`,
  `${G}/ElephantsDream.mp4`,
  `${G}/BigBuckBunny.mp4`,
  `${G}/ForBiggerBlazes.mp4`,
  `${G}/ForBiggerEscapes.mp4`,
  `${G}/ForBiggerFun.mp4`,
  `${G}/ForBiggerJoyrides.mp4`,
  `${G}/ForBiggerMeltdowns.mp4`,
];

export const CAPTIONS_URL = "/assets/captions-demo.vtt";

/* ──────────────────────────────────────────────────────────────
 * Categories — the 14 entries shown on the Explore page.
 * The first three are curated collections that link to their own
 * routes; the remaining eleven are real content categories.
 * Each carries a unique icon key from the shared registry.
 * ────────────────────────────────────────────────────────────── */
export const CATEGORIES: Category[] = [
  {
    slug: "trending",
    name: "Trending",
    blurb: "What everyone is watching right now.",
    image: THUMBS.neonRedGlow,
    gradient: "from-rose-600/80 via-rose-900/40",
    icon: "flame",
    href: "/trending",
  },
  {
    slug: "popular",
    name: "Popular",
    blurb: "All-time viewer favorites.",
    image: THUMBS.satinIridescent,
    gradient: "from-fuchsia-600/80 via-fuchsia-900/40",
    icon: "trending-up",
    href: "/popular",
  },
  {
    slug: "new",
    name: "New",
    blurb: "Fresh arrivals, added daily.",
    image: THUMBS.candleGlass,
    gradient: "from-violet-600/80 via-violet-900/40",
    icon: "sparkles",
    href: "/new",
  },
  {
    slug: "amateur",
    name: "Amateur",
    blurb: "Candid, unscripted energy.",
    image: THUMBS.streetCouple,
    gradient: "from-amber-600/80 via-amber-900/40",
    icon: "camera",
  },
  {
    slug: "hardcore",
    name: "Hardcore",
    blurb: "Intense, high-energy sessions.",
    image: THUMBS.velvetRed,
    gradient: "from-red-600/80 via-red-900/40",
    icon: "zap",
  },
  {
    slug: "young-18",
    name: "Young 18+",
    blurb: "Barely legal adults, verified 18 and over.",
    image: THUMBS.candlesSoft,
    gradient: "from-pink-600/80 via-pink-900/40",
    icon: "cake",
  },
  {
    slug: "masturbation",
    name: "Masturbation",
    blurb: "Solo pleasure, intimate and unhurried.",
    image: THUMBS.neonCorridor,
    gradient: "from-purple-600/80 via-purple-900/40",
    icon: "hand",
  },
  {
    slug: "lesbian",
    name: "Lesbian",
    blurb: "Women together, chemistry first.",
    image: THUMBS.kissMotion,
    gradient: "from-rose-500/80 via-rose-900/40",
    icon: "venus",
  },
  {
    slug: "threesome",
    name: "Threesome",
    blurb: "Three's company — group encounters.",
    image: THUMBS.corridorPair,
    gradient: "from-indigo-600/80 via-indigo-900/40",
    icon: "users",
  },
  {
    slug: "ebony",
    name: "Ebony",
    blurb: "Stunning ebony performers.",
    image: THUMBS.suitNight,
    gradient: "from-zinc-500/70 via-zinc-800/40",
    icon: "moon",
  },
  {
    slug: "creampie",
    name: "Creampie",
    blurb: "Finishing inside, up close.",
    image: THUMBS.satinRipples,
    gradient: "from-sky-600/80 via-sky-900/40",
    icon: "droplets",
  },
  {
    slug: "asian",
    name: "Asian",
    blurb: "Asian performers and productions.",
    image: THUMBS.silkPurple,
    gradient: "from-emerald-600/80 via-emerald-900/40",
    icon: "flower",
  },
  {
    slug: "massage",
    name: "Massage",
    blurb: "Oiled hands and slow, sensual bodywork.",
    image: THUMBS.candleBedside,
    gradient: "from-teal-600/80 via-teal-900/40",
    icon: "hand-heart",
  },
  {
    slug: "blonde",
    name: "Blonde",
    blurb: "Golden-haired favorites.",
    image: THUMBS.furRedNight,
    gradient: "from-yellow-500/80 via-amber-900/40",
    icon: "sun",
  },
];

export const BROWSE_CATEGORIES: Category[] = CATEGORIES.filter((c) => !c.href);
export const categoryBySlug: Map<string, Category> = new Map(CATEGORIES.map((c) => [c.slug, c]));
export const categoryName = (slug: string) => categoryBySlug.get(slug)?.name ?? slug;

/* ── Fictional performer names (demo only) ── */
const PERFORMERS = [
  "Ava Noir",
  "Luna Rey",
  "Mia Voss",
  "Ivy Laurent",
  "Roxanne Vale",
  "Cleo Marchetti",
  "Dahlia Storm",
  "Violet Asher",
  "Naomi Faye",
  "Scarlett Devine",
  "Jade Wren",
  "Sofia Black",
];

const TAG_POOL = [
  "Cinematic", "4K", "Slow Burn", "Remastered", "Exclusive", "Late Night",
  "Studio Cut", "Award Winner", "Staff Pick", "Score", "Intimate", "Neon",
  "Candlelit", "Premium Cut", "Series", "BTS",
];

const DESCRIPTIONS = [
  (cat: string) =>
    `A slow-burning ${cat} feature shot after midnight — low practical light, deliberate pacing and a cinematic grade that keeps every frame looking like a film still. Stream now in up to 4K.`,
  (cat: string) =>
    `This ${cat} cut trades noise for atmosphere: long lenses, warm shadows and an unhurried rhythm. One of the most requested sessions in the EroBabe archive.`,
  (cat: string) =>
    `Produced as part of the EroBabe ${cat} series, this session keeps things understated and intimate, with the focus on mood, texture and light.`,
  (cat: string) =>
    `A fan favorite from the ${cat} collection — remastered with richer blacks, softer highlights and a slower, more deliberate edit.`,
  (cat: string) =>
    `Minimal dialogue, maximal mood. This ${cat} entry leans on candlelight, silk and city glow to build a slow, atmospheric experience.`,
];

interface RawRow {
  t: string; // title
  c: CategorySlug; // category
  d: number; // days ago
  p: number; // performer index
}

const RAW: RawRow[] = [
  { t: "Midnight Studio Session", c: "hardcore", d: 2, p: 0 },
  { t: "Velvet Hour", c: "masturbation", d: 3, p: 1 },
  { t: "Neon Silhouettes", c: "threesome", d: 5, p: 2 },
  { t: "Afterglow", c: "creampie", d: 6, p: 3 },
  { t: "Slow Burn", c: "blonde", d: 8, p: 4 },
  { t: "Crimson Silk", c: "masturbation", d: 9, p: 1 },
  { t: "City Lights Rendezvous", c: "threesome", d: 11, p: 5 },
  { t: "Golden Hour", c: "amateur", d: 12, p: 6 },
  { t: "Satin & Shadows", c: "hardcore", d: 14, p: 7 },
  { t: "Last Call", c: "amateur", d: 15, p: 8 },
  { t: "Dusk Till Dawn", c: "asian", d: 16, p: 9 },
  { t: "Soft Focus", c: "masturbation", d: 18, p: 10 },
  { t: "Candlelight", c: "massage", d: 20, p: 11 },
  { t: "Late Checkout", c: "amateur", d: 21, p: 5 },
  { t: "Ember", c: "hardcore", d: 22, p: 4 },
  { t: "Nightcap", c: "lesbian", d: 1, p: 2 },
  { t: "After Hours", c: "blonde", d: 23, p: 0 },
  { t: "Heatwave", c: "asian", d: 24, p: 8 },
  { t: "Linger", c: "masturbation", d: 4, p: 1 },
  { t: "Moonlit", c: "ebony", d: 25, p: 6 },
  { t: "The Red Door", c: "hardcore", d: 26, p: 11 },
  { t: "Pink Champagne", c: "blonde", d: 2, p: 7 },
  { t: "Dark Room", c: "amateur", d: 27, p: 9 },
  { t: "Between the Sheets", c: "creampie", d: 28, p: 3 },
  { t: "First Light", c: "young-18", d: 30, p: 10 },
  { t: "Low Light", c: "amateur", d: 31, p: 8 },
  { t: "Warm Static", c: "hardcore", d: 33, p: 0 },
  { t: "Silhouette Study", c: "masturbation", d: 34, p: 4 },
  { t: "Velvet Rope", c: "blonde", d: 35, p: 11 },
  { t: "Private Screening", c: "young-18", d: 5, p: 2 },
  { t: "Room Service", c: "massage", d: 36, p: 5 },
  { t: "Scarlet Hour", c: "hardcore", d: 38, p: 7 },
  { t: "Midnight Oil", c: "masturbation", d: 40, p: 10 },
  { t: "Honeymoon Phase", c: "creampie", d: 41, p: 6 },
  { t: "Slow Motion", c: "asian", d: 42, p: 8 },
  { t: "Sweet Spot", c: "young-18", d: 44, p: 9 },
  { t: "Close Up", c: "masturbation", d: 45, p: 1 },
  { t: "Whispers", c: "massage", d: 47, p: 3 },
  { t: "Desire Lines", c: "lesbian", d: 7, p: 0 },
  { t: "Touch of Pink", c: "young-18", d: 49, p: 10 },
  { t: "Deep Red", c: "hardcore", d: 50, p: 11 },
  { t: "Lantern Light", c: "ebony", d: 52, p: 2 },
  { t: "Blush", c: "young-18", d: 55, p: 6 },
  { t: "Fever Dream", c: "lesbian", d: 6, p: 4 },
  { t: "Second Skin", c: "asian", d: 58, p: 9 },
  { t: "Night Shift", c: "ebony", d: 60, p: 8 },
];

const EDITORS_PICKS = new Set(["slow-burn", "fever-dream", "desire-lines", "after-hours", "velvet-rope", "private-screening"]);

/* Deterministic PRNG so the demo data is stable between builds. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function build(): Video[] {
  const list = RAW.map((row, i): Video => {
    const rng = mulberry32(i * 9301 + 49297);
    const views = Math.floor(180_000 + rng() * 8_600_000);
    const duration = Math.floor(190 + rng() * 1500); // ~3–28 min
    const cat = categoryName(row.c);
    const tag2 = TAG_POOL[Math.floor(rng() * TAG_POOL.length)];
    const tag3 = TAG_POOL[(i * 5 + 3) % TAG_POOL.length];
    const tags = Array.from(new Set([cat, tag2, tag3]));
    return {
      id: slugify(row.t),
      title: row.t,
      category: row.c,
      duration,
      durationLabel: formatDuration(duration),
      views,
      viewsLabel: formatViews(views),
      daysAgo: row.d,
      dateLabel: timeAgo(row.d),
      likeRatio: Math.floor(78 + rng() * 20),
      thumbnail: THUMB_LIST[(i * 7 + 2) % THUMB_LIST.length],
      videoUrl: DEMO_SOURCES[i % DEMO_SOURCES.length],
      tags,
      performer: PERFORMERS[row.p % PERFORMERS.length],
      description: DESCRIPTIONS[i % DESCRIPTIONS.length](cat),
      score: 0,
    } satisfies Video;
  });

  // Flags derived after the base pass.
  for (const v of list) v.score = v.views / Math.pow(v.daysAgo + 2, 0.78);
  const byScore = [...list].sort((a, b) => b.score - a.score);
  byScore.slice(0, 12).forEach((v) => (v.trending = true));
  for (const v of list) {
    v.hot = v.views >= 4_200_000;
    v.isNew = v.daysAgo <= 10;
    v.editorsPick = EDITORS_PICKS.has(v.id);
  }
  const featured = list.find((v) => v.id === "velvet-hour");
  if (featured) featured.featured = true;
  return list;
}

export let VIDEOS: Video[] = build();

let byId = new Map(VIDEOS.map((v) => [v.id, v]));
/** Resolve by slug (primary routing key) and fall back to the database uuid. */
export const getVideoById = (id: string) => byId.get(id) ?? VIDEOS.find((v) => v.uuid === id);

export const byCategory = (slug: string) => VIDEOS.filter((v) => v.category === slug);
export const categoryCount = (slug: string) => byCategory(slug).length;

/* ── Static rails (unchanged behaviour) ── */
export let popularVideos = [...VIDEOS].sort((a, b) => b.views - a.views);
export let newVideos = [...VIDEOS].sort((a, b) => a.daysAgo - b.daysAgo);
export let mostViewed = popularVideos.slice(0, 10);

/* ── Algorithm-driven discovery sections (limits enforced centrally) ── */
const initialSections: DiscoverySections = rankSections(VIDEOS);
export let featuredVideos: Video[] = initialSections.featured;   // max 5
export let trendingVideos: Video[] = initialSections.trending;   // max 8
export let risingVideos: Video[] = initialSections.rising;       // max 3
export let editorsPicks: Video[] = initialSections.editors;      // max 5
export let featuredVideo: Video = featuredVideos[0] ?? VIDEOS[0];

export let TOTAL_VIDEOS = VIDEOS.length;
export let TOTAL_VIEWS = VIDEOS.reduce((n, v) => n + v.views, 0);

/**
 * Hot-swap the built-in demo catalog for the live published catalog
 * fetched from the CMS backend. Called once by bootstrapCatalog()
 * before first render — every page derives from these live bindings.
 */
export function installCatalog(videos: Video[]) {
  VIDEOS = videos;
  byId = new Map(videos.map((v) => [v.id, v]));
  popularVideos = [...videos].sort((a, b) => b.views - a.views);
  newVideos = [...videos].sort((a, b) => a.daysAgo - b.daysAgo);
  mostViewed = popularVideos.slice(0, 10);
  applySections(rankSections(videos));
  TOTAL_VIDEOS = videos.length;
  TOTAL_VIEWS = videos.reduce((n, v) => n + v.views, 0);
}

function applySections(next: DiscoverySections) {
  featuredVideos = next.featured;
  trendingVideos = next.trending;
  risingVideos = next.rising;
  editorsPicks = next.editors;
  featuredVideo = next.featured[0] ?? VIDEOS[0];
}

/**
 * Install the server-ranked line-ups produced by the analytics scoring
 * engine (`/api/public/discovery`). Ordering and limits come straight
 * from the algorithm; unresolved ids are skipped.
 */
export function applyDiscovery(ids: {
  featured: string[];
  trending: string[];
  rising: string[];
  editors: string[];
}) {
  const ranked = sectionsFromIds(VIDEOS, ids);
  const local = rankSections(VIDEOS);
  // Fall back per-section so a cold analytics window never blanks a rail.
  applySections({
    featured: ranked.featured.length ? ranked.featured : local.featured,
    trending: ranked.trending.length ? ranked.trending : local.trending,
    rising: ranked.rising.length ? ranked.rising : local.rising,
    editors: ranked.editors,
  });
}

/** Merge backend categories into the display catalog (names, blurbs, gradients, covers). */
export function mergeRemoteCategories(
  remote: {
    slug: string; name: string; blurb: string | null;
    gradient: string | null; image: string | null; icon?: string | null;
  }[]
) {
  const fallbackImages = Object.values(THUMBS);
  for (const [i, rc] of remote.entries()) {
    if (rc.slug === "trending" || rc.slug === "popular" || rc.slug === "new") continue;
    const existing = CATEGORIES.find((c) => c.slug === rc.slug && !c.href);
    if (existing) {
      existing.name = rc.name || existing.name;
      existing.blurb = rc.blurb || existing.blurb;
      existing.gradient = rc.gradient || existing.gradient;
      if (rc.icon) existing.icon = rc.icon;
      if (rc.image) existing.image = rc.image;
    } else {
      CATEGORIES.push({
        slug: rc.slug,
        name: rc.name,
        blurb: rc.blurb ?? "",
        gradient: rc.gradient ?? "from-zinc-500/70 via-zinc-800/40",
        icon: rc.icon ?? undefined,
        image: rc.image ?? fallbackImages[(i * 7 + 3) % fallbackImages.length],
      });
    }
  }
  categoryBySlug.clear();
  CATEGORIES.forEach((c) => categoryBySlug.set(c.slug, c));
  BROWSE_CATEGORIES.length = 0;
  BROWSE_CATEGORIES.push(...CATEGORIES.filter((c) => !c.href));
}

/** Category neighbours first, then trending, then everything else. */
export function relatedVideos(video: Video, count = 10): Video[] {
  const seen = new Set([video.id]);
  const out: Video[] = [];
  const push = (v: Video) => {
    if (out.length >= count || seen.has(v.id)) return;
    seen.add(v.id);
    out.push(v);
  };
  byCategory(video.category)
    .sort((a, b) => b.views - a.views)
    .forEach(push);
  trendingVideos.forEach(push);
  popularVideos.forEach(push);
  return out.slice(0, count);
}

export const popularTags = [
  "Cinematic", "4K", "Slow Burn", "Neon", "Candlelit", "Exclusive",
  "Studio Cut", "Late Night", "Series", "Remastered",
];

/** Client-side search over title, category, tags, performer and duration. */
export function searchVideos(query: string): Video[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9:]+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored: { v: Video; s: number }[] = [];
  for (const v of VIDEOS) {
    const hay =
      `${v.title} ${categoryName(v.category)} ${v.tags.join(" ")} ${v.performer} ${v.durationLabel}`.toLowerCase();
    let s = 0;
    let ok = true;
    for (const t of tokens) {
      if (!hay.includes(t)) {
        ok = false;
        break;
      }
      if (v.title.toLowerCase().includes(t)) s += 3;
      else if (v.tags.some((tag) => tag.toLowerCase().includes(t))) s += 2;
      else s += 1;
    }
    if (ok) scored.push({ v, s: s + v.views / 1e8 });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.v);
}

/** Lightweight suggestions for the search overlay. */
export function suggest(query: string, limit = 7): { label: string; kind: "video" | "category" | "tag"; id?: string }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { label: string; kind: "video" | "category" | "tag"; id?: string }[] = [];
  for (const c of CATEGORIES) {
    if (c.name.toLowerCase().includes(q)) out.push({ label: c.name, kind: "category" });
  }
  for (const tag of TAG_POOL) {
    if (tag.toLowerCase().includes(q) && !out.some((o) => o.label === tag)) out.push({ label: tag, kind: "tag" });
  }
  for (const v of popularVideos) {
    if (v.title.toLowerCase().includes(q)) out.push({ label: v.title, kind: "video", id: v.id });
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

export const demoNotice =
  "An 18+ adult-content website featuring videos and media intended exclusively for adults. Please use the website responsibly and ensure your access complies with applicable laws in your jurisdiction.";
