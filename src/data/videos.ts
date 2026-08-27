/**
 * EroBabe demo catalog.
 * All titles, performers and metadata are fictional. Thumbnails are tasteful
 * editorial stock photography; demo playback uses public sample video files.
 * Replace `thumbnail` / `videoUrl` with real assets later — no component
 * changes required.
 */

export interface Video {
  id: string;
  slug: string;
  title: string;
  category: string; // category slug
  tags: string[];
  durationSec: number;
  views: number;
  daysAgo: number; // recency used for "x ago" labels + trending math
  performer: string;
  studio?: string;
  quality: "4K" | "HD";
  featured?: boolean;
  trending?: boolean;
  thumbnail: string;
  videoUrl: string;
  description: string;
  createdAt: string; // ISO
}

export interface Category {
  slug: string;
  name: string;
  blurb: string;
  image: string;
  accent: string; // tailwind gradient classes
  icon: string; // key from ICON_REGISTRY (shared with the admin CMS)
  virtual?: boolean; // feed-style category (trending/popular/new) — no slug filter
}

/* ------------------------------------------------------------------ */
/* Media pools                                                         */
/* ------------------------------------------------------------------ */

const px = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`;

export const THUMBS = [
  px(36806859), px(16077169), px(35032199), px(14536731), px(32260697),
  px(32260696), px(12429764), px(37258529), px(38291937), px(8271461),
  px(8983546), px(11565547), px(8553208), px(6800204), px(3077733),
  px(27700168), px(31011826), px(6800200), px(9278288), px(4636394),
  px(219650), px(9097277), px(17767908), px(36689954), px(16078511),
  px(5645105), px(919382), px(9130235), px(30536608), px(31663603),
  px(38422741), px(37737571), px(38394973), px(38394971), px(37737570),
  px(37538266), px(37942450), px(37557736), px(36208816), px(36267051),
];

/** Public sample MP4s used as demo playback sources (easily replaced). */
const gtv = (name: string) =>
  `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/${name}.mp4`;

export const VIDEO_POOL = [
  gtv("ForBiggerBlazes"),
  gtv("ForBiggerEscapes"),
  gtv("ForBiggerFun"),
  gtv("ForBiggerJoyrides"),
  gtv("ForBiggerMeltdowns"),
  gtv("BigBuckBunny"),
  gtv("ElephantsDream"),
  gtv("Sintel"),
  gtv("TearsOfSteel"),
];

export const FALLBACK_THUMB = "/assets/brand/og-cover.jpg";

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export const CATEGORIES: Category[] = [
  { slug: "trending", name: "Trending", blurb: "What everyone is watching right now.", image: THUMBS[31], accent: "from-rose-600/60", icon: "flame", virtual: true },
  { slug: "popular", name: "Popular", blurb: "All-time viewer favorites.", image: THUMBS[0], accent: "from-violet-600/60", icon: "crown", virtual: true },
  { slug: "new", name: "New", blurb: "The latest uploads, freshest first.", image: THUMBS[38], accent: "from-fuchsia-600/60", icon: "sparkles", virtual: true },
  { slug: "amateur", name: "Amateur", blurb: "Unpolished, authentic, self-shot.", image: THUMBS[24], accent: "from-pink-600/60", icon: "camera" },
  { slug: "hardcore", name: "Hardcore", blurb: "Intense, full-throttle scenes.", image: THUMBS[4], accent: "from-red-700/60", icon: "zap" },
  { slug: "young-18", name: "Young 18+", blurb: "Fresh faces — strictly verified adults.", image: THUMBS[6], accent: "from-amber-500/60", icon: "sprout" },
  { slug: "masturbation", name: "Masturbation", blurb: "Solo scenes, full focus.", image: THUMBS[21], accent: "from-purple-600/60", icon: "hand" },
  { slug: "lesbian", name: "Lesbian", blurb: "Women-only chemistry.", image: THUMBS[12], accent: "from-fuchsia-600/60", icon: "hearts" },
  { slug: "threesome", name: "Threesome", blurb: "Three's company.", image: THUMBS[16], accent: "from-rose-500/60", icon: "users" },
  { slug: "ebony", name: "Ebony", blurb: "Melanin-rich performers.", image: THUMBS[20], accent: "from-amber-900/70", icon: "moon" },
  { slug: "creampie", name: "Creampie", blurb: "The warmest finales.", image: THUMBS[36], accent: "from-rose-400/60", icon: "icecream" },
  { slug: "asian", name: "Asian", blurb: "East Asian performers.", image: THUMBS[9], accent: "from-sky-600/60", icon: "flower" },
  { slug: "massage", name: "Massage", blurb: "Oiled hands, slow release.", image: THUMBS[22], accent: "from-teal-600/60", icon: "waves" },
  { slug: "blonde", name: "Blonde", blurb: "Golden-haired scenes.", image: THUMBS[1], accent: "from-amber-400/60", icon: "sun" },
];

export const VIRTUAL_CATEGORY_SORT: Record<string, "trending" | "viewed" | "newest"> = {
  trending: "trending",
  popular: "viewed",
  new: "newest",
};

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

// [title, category, durSec, views, daysAgo, performer, tags, quality, featured, trending]
type Row = [string, string, number, number, number, string, string[], "4K" | "HD", boolean, boolean];

const ROWS: Row[] = [
  ["Midnight Studio Session", "hardcore", 1422, 2410000, 2, "Lena Moreau", ["Featured", "Night"], "4K", true, true],
  ["Neon Reverie", "masturbation", 958, 1890000, 1, "Ava Noir", ["Neon", "Moody"], "4K", false, true],
  ["Velvet Hours", "massage", 1734, 1220000, 5, "Camille Rose", ["Silk", "Slow"], "HD", false, false],
  ["Afterglow", "creampie", 1290, 3140000, 3, "Scarlett Vane & Max Doyle", ["Intimate", "Warm"], "4K", false, true],
  ["Crimson Silk", "blonde", 2081, 980000, 7, "Vera Sinclair", ["Exclusive", "Editorial"], "4K", true, false],
  ["Two in the Dark", "threesome", 1104, 764000, 9, "Ruby Castell & Leo Ardant", ["Low Light"], "HD", false, false],
  ["Windowsill", "blonde", 812, 2260000, 4, "Isabella Hart", ["Natural Light"], "4K", false, true],
  ["Static & Silk", "asian", 2642, 612000, 12, "Various", ["Best Of", "Edited"], "HD", false, false],
  ["Penthouse Lights", "ebony", 1512, 1430000, 6, "Bianca Snow", ["City", "High Rise"], "4K", false, true],
  ["Raw Cut: Morning", "amateur", 693, 538000, 2, "Freya Lindt", ["Self Shot", "Authentic"], "HD", false, false],
  ["Slow Motion Hearts", "lesbian", 1876, 1750000, 8, "Jade Marlowe", ["Story", "Slow Burn"], "4K", false, true],
  ["Rosewater", "masturbation", 1044, 891000, 11, "Mila Laurent", ["Soft", "Close Up"], "HD", false, false],
  ["Champagne Static", "blonde", 1338, 2010000, 5, "Sienna Fox", ["Party", "Gold"], "4K", false, true],
  ["After Hours", "hardcore", 1602, 1190000, 14, "Nadia Belle", ["Late Night"], "4K", false, false],
  ["Fever Dream", "asian", 1266, 940000, 10, "Ava Noir", ["Haze", "Neon"], "HD", false, false],
  ["Her Favorite Song", "young-18", 927, 1320000, 3, "Odette Reyes", ["Music", "Playful"], "4K", false, true],
  ["Moonlight Confession", "massage", 1951, 702000, 16, "Clara Vale", ["Story", "Moonlight"], "4K", false, false],
  ["The Red Room", "creampie", 2214, 1680000, 9, "Vera Sinclair", ["Exclusive", "Red"], "4K", false, true],
  ["Weekend at Home", "amateur", 1188, 2890000, 2, "Ivy Delacroix", ["Real", "Morning"], "HD", false, true],
  ["Second Skin", "massage", 1459, 565000, 18, "Camille Rose", ["Lace", "Shadow"], "HD", false, false],
  ["Midnight Radio", "hardcore", 3011, 1980000, 4, "Various", ["Mix", "Late Night"], "4K", false, true],
  ["Slow Burn", "creampie", 1537, 845000, 13, "Scarlett Vane & Max Doyle", ["Chemistry"], "4K", false, false],
  ["Nightshift", "ebony", 1092, 477000, 21, "Jade Marlowe", ["City", "Neon"], "HD", false, false],
  ["Satin & Smoke", "asian", 1648, 2130000, 6, "Bianca Snow", ["Satin", "Haze"], "4K", false, true],
  ["First Takes", "amateur", 845, 689000, 7, "Freya Lindt", ["Unedited"], "HD", false, false],
  ["The Director's Cut", "hardcore", 2473, 1050000, 20, "Lena Moreau", ["Extended"], "4K", false, false],
  ["One More Glass", "blonde", 1326, 914000, 15, "Sienna Fox", ["Evening"], "4K", false, false],
  ["Pink Noise", "young-18", 1008, 2470000, 1, "Mila Laurent", ["Playful", "Color"], "4K", false, true],
  ["Best of 2026 — Vol. 4", "creampie", 3284, 1540000, 3, "Various", ["Best Of", "Top Rated"], "4K", false, true],
  ["Letter from Lyon", "lesbian", 1789, 612000, 24, "Odette Reyes", ["Story", "Travel"], "4K", false, false],
  ["After the Party", "amateur", 762, 1890000, 5, "Ivy Delacroix", ["Real", "Night"], "HD", false, true],
  ["Marlowe & Vane", "threesome", 1695, 1410000, 12, "Jade Marlowe & Nico Vane", ["Group"], "4K", true, false],
  ["Studio 54 Sessions", "ebony", 1581, 733000, 17, "Nadia Belle", ["Retro", "Disco"], "HD", false, false],
  ["Undressed Light", "blonde", 1214, 968000, 19, "Clara Vale", ["Window Light"], "4K", false, false],
  ["High Rise Hearts", "asian", 1467, 1280000, 8, "Bianca Snow", ["Skyline"], "4K", false, false],
  ["Long Exposure", "young-18", 1902, 2650000, 2, "Clara Vale", ["Art", "Slow"], "4K", true, true],
  ["Fitted for Silk", "massage", 2057, 587000, 26, "Vera Sinclair", ["Editorial"], "4K", false, false],
  ["Close-Up: Iris", "masturbation", 894, 1120000, 10, "Isabella Hart", ["Intimate"], "HD", false, false],
  ["The Loft Tapes", "amateur", 1349, 806000, 22, "Freya Lindt", ["Loft", "RAW"], "HD", false, false],
  ["Noir Étude", "ebony", 1823, 1360000, 6, "Ava Noir", ["Study", "Shadow"], "4K", true, true],
];

const DESCRIPTIONS = [
  "A slow-burning session shot with cinematic lighting and an intimate, unhurried pace. One of the most requested scenes in the catalog this month.",
  "Filmed across a single evening with practical neon and haze, this scene leans into atmosphere first — moody, stylish and deliberately paced.",
  "A soft, editorial production with silk textures and natural window light. Warm, elegant and unmistakably premium.",
  "Real chemistry carries this scene from beginning to end. Unscripted, playful and intimate — a viewer favorite since release.",
  "A flagship production with editorial grading, designer styling and an extended cut exclusive to EroBabe.",
];

export const VIDEOS: Video[] = ROWS.map((r, i) => {
  const [title, category, durationSec, views, daysAgo, performer, tags, quality, featured, trending] = r;
  return {
    id: String(i + 1),
    slug: slugify(title),
    title,
    category,
    tags,
    durationSec,
    views,
    daysAgo,
    performer,
    studio: category === "studio" || category === "premium" ? "EroBabe Originals" : undefined,
    quality,
    featured,
    trending,
    thumbnail: THUMBS[i % THUMBS.length],
    videoUrl: VIDEO_POOL[i % VIDEO_POOL.length],
    description: DESCRIPTIONS[i % DESCRIPTIONS.length],
    createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString(),
  };
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function timeAgo(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} week${days >= 14 ? "s" : ""} ago`;
  return `${Math.round(days / 30)} month${days >= 60 ? "s" : ""} ago`;
}

export function categoryBySlug(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug);
}

/** Simple trending score: recency-weighted views. */
export function trendingScore(v: Video): number {
  return v.views / Math.pow(v.daysAgo + 1.4, 1.35);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
