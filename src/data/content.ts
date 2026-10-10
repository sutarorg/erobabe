import {
  Camera,
  Drama,
  Eye,
  Flame,
  Flower2,
  Heart,
  HeartHandshake,
  LayoutGrid,
  Sparkles,
  UserRound,
  Users,
  VenetianMask,
  Wine,
  type LucideIcon,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

export const LOGO_URL =
  "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Category {
  id: string;
  /** Canonical name — the value videos are tagged with and filters use. */
  label: string;
  icon: LucideIcon;
}

export interface Video {
  id: string;
  title: string;
  category: string;
  duration: string;
  quality: "4K" | "HD";
  views: string;
  viewsNum: number;
  added: string;
  daysAgo: number;
  rating: number;
  thumb: string;
  alt: string;
  description: string;
  featured?: boolean;
}

export interface HeroSlide {
  id: string;
  eyebrow: string;
  headline: string;
  sub: string;
  image: string;
  alt: string;
}

/* ------------------------------------------------------------------ */
/* Imagery (licensed editorial stock photography — tasteful, adults)   */
/* ------------------------------------------------------------------ */

const px = (id: number, ext: "jpeg" | "png" = "jpeg") =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.${ext}?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`;

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export const CATEGORIES: Category[] = [
  { id: "mature", label: "Mature", icon: Flame },
  { id: "amateur", label: "Amateur", icon: Camera },
  { id: "pov", label: "POV", icon: Eye },
  { id: "lesbian", label: "Lesbian", icon: Users },
  { id: "kinky", label: "Kinky", icon: VenetianMask },
  { id: "mature18", label: "Mature 18+", icon: Wine },
  { id: "couples", label: "Couples", icon: HeartHandshake },
  { id: "more", label: "More", icon: LayoutGrid },
];

/** Additional categories surfaced on the dedicated /categories page. */
export const EXTRA_CATEGORIES: Category[] = [
  { id: "boudoir", label: "Boudoir", icon: Sparkles },
  { id: "romantic", label: "Romantic", icon: Heart },
  { id: "solo", label: "Solo", icon: UserRound },
  { id: "roleplay", label: "Roleplay", icon: Drama },
  { id: "massage", label: "Massage", icon: Flower2 },
];

/** Every browsable category (excludes the "More" shortcut tile). */
export const ALL_CATEGORIES: Category[] = [
  ...CATEGORIES.filter((c) => c.id !== "more"),
  ...EXTRA_CATEGORIES,
];

/** URL-safe slug for a category, e.g. "Mature 18+" → "mature-18plus". */
export const categorySlug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Resolve a slug back to its canonical category label. */
export const categoryFromSlug = (slug: string): string | null =>
  ALL_CATEGORIES.find((c) => categorySlug(c.label) === slug)?.label ?? null;

/* ------------------------------------------------------------------ */
/* Hero carousel                                                       */
/* ------------------------------------------------------------------ */

export const HERO_SLIDES: HeroSlide[] = [
  {
    id: "desire",
    eyebrow: "Hot & Exclusive",
    headline: "Seductive stories.\nEndless desire.",
    sub: "Explore premium videos and exclusive moments you won't find anywhere else.",
    image: px(36500653),
    alt: "Elegant woman in an evening dress resting on a bed in dramatic moody lighting",
  },
  {
    id: "afterhours",
    eyebrow: "New This Week",
    headline: "After hours.\nJust the two of us.",
    sub: "Intimate cinematic encounters, captured in the glow of the city.",
    image: px(27441035),
    alt: "Silhouette of an adult couple embracing beside tall windows at night",
  },
  {
    id: "velvet",
    eyebrow: "Editor's Pick",
    headline: "Velvet nights.\nZero compromise.",
    sub: "Hand-picked premium scenes, curated daily in stunning 4K quality.",
    image: px(19186315),
    alt: "Elegant woman in a black dress enjoying a glass of wine in moody lighting",
  },
];

/* ------------------------------------------------------------------ */
/* Videos (mock metadata — no real media is hosted or streamed)        */
/* ------------------------------------------------------------------ */

export const VIDEOS: Video[] = [
  {
    id: "late-night-temptation",
    title: "Late Night Temptation",
    category: "Mature",
    duration: "24:08",
    quality: "4K",
    views: "2.4M",
    viewsNum: 2_400_000,
    added: "2 days ago",
    daysAgo: 2,
    rating: 98,
    thumb: px(24407296),
    alt: "Stylish woman in a dimly lit room holding a glass of wine",
    description:
      "A slow-burning after-hours encounter in a candlelit loft, where every glance lingers a little longer than it should.",
    featured: true,
  },
  {
    id: "morning-desire",
    title: "Morning Desire",
    category: "Couples",
    duration: "18:42",
    quality: "4K",
    views: "1.8M",
    viewsNum: 1_800_000,
    added: "3 days ago",
    daysAgo: 3,
    rating: 97,
    thumb: px(10442969),
    alt: "Woman in a white dress resting on a bed bathed in warm morning light",
    description:
      "Soft daylight, silk sheets and an unhurried morning that neither of them wants to end.",
    featured: true,
  },
  {
    id: "sensual-moments",
    title: "Sensual Moments",
    category: "Lesbian",
    duration: "21:15",
    quality: "HD",
    views: "3.1M",
    viewsNum: 3_100_000,
    added: "5 days ago",
    daysAgo: 5,
    rating: 99,
    thumb: px(38074638),
    alt: "Confident woman posing gracefully in a softly lit boudoir setting",
    description:
      "An elegant, slow-paced portrait of chemistry and confidence, captured in soft cinematic light.",
    featured: true,
  },
  {
    id: "after-dark",
    title: "After Dark",
    category: "Kinky",
    duration: "27:33",
    quality: "4K",
    views: "4.2M",
    viewsNum: 4_200_000,
    added: "1 week ago",
    daysAgo: 7,
    rating: 96,
    thumb: px(7277907),
    alt: "Captivating close-up portrait of a woman under deep red lighting",
    description:
      "When the city sleeps, the masks come on. A daring late-night session bathed in crimson.",
    featured: true,
  },
  {
    id: "midnight-confessions",
    title: "Midnight Confessions",
    category: "POV",
    duration: "15:26",
    quality: "4K",
    views: "812K",
    viewsNum: 812_000,
    added: "16 hours ago",
    daysAgo: 1,
    rating: 95,
    thumb: px(17553416),
    alt: "Artistic black and white portrait of a woman in a sensual pose indoors",
    description:
      "Whispered secrets and stolen glances in a monochrome world of shadow and silk.",
  },
  {
    id: "crimson-whisper",
    title: "Crimson Whisper",
    category: "Kinky",
    duration: "22:47",
    quality: "4K",
    views: "522K",
    viewsNum: 522_000,
    added: "20 hours ago",
    daysAgo: 1,
    rating: 95,
    thumb: px(736415),
    alt: "Glamorous woman in an elegant black dress lying across a bed",
    description:
      "Old-Hollywood glamour meets modern mischief in this velvet-draped midnight affair.",
  },
  {
    id: "velvet-touch",
    title: "Velvet Touch",
    category: "Mature 18+",
    duration: "19:08",
    quality: "HD",
    views: "965K",
    viewsNum: 965_000,
    added: "2 days ago",
    daysAgo: 2,
    rating: 94,
    thumb: px(38500521),
    alt: "Woman relaxing in an ornately decorated luxurious bedroom",
    description:
      "Refined, confident and utterly in control — a masterclass in taking things slowly.",
  },
  {
    id: "secret-rendezvous",
    title: "Secret Rendezvous",
    category: "Couples",
    duration: "26:54",
    quality: "4K",
    views: "1.1M",
    viewsNum: 1_100_000,
    added: "2 days ago",
    daysAgo: 2,
    rating: 97,
    thumb: px(6537115),
    alt: "Couple sharing a kiss in a romantic black and white city setting",
    description:
      "Two strangers, one rooftop, and a city that keeps their secret until sunrise.",
  },
  {
    id: "golden-hour",
    title: "Golden Hour",
    category: "Amateur",
    duration: "14:31",
    quality: "HD",
    views: "733K",
    viewsNum: 733_000,
    added: "3 days ago",
    daysAgo: 3,
    rating: 93,
    thumb: px(14541510),
    alt: "Couple looking out at a glowing city skyline through a window",
    description:
      "Chasing the last light of the evening from the best seat in the city.",
  },
  {
    id: "silk-shadows",
    title: "Silk & Shadows",
    category: "Mature",
    duration: "23:19",
    quality: "4K",
    views: "1.5M",
    viewsNum: 1_500_000,
    added: "4 days ago",
    daysAgo: 4,
    rating: 96,
    thumb: px(9140302),
    alt: "Elegant black and white portrait of a woman posing on a bed",
    description:
      "A study in contrast — light, shadow and the space in between.",
  },
  {
    id: "city-of-glass",
    title: "City of Glass",
    category: "POV",
    duration: "17:44",
    quality: "HD",
    views: "1.2M",
    viewsNum: 1_200_000,
    added: "6 days ago",
    daysAgo: 6,
    rating: 92,
    thumb: px(12747511, "png"),
    alt: "Silhouette of a couple gazing at the sunset over a city skyline",
    description:
      "Floor-to-ceiling windows, forty floors up, and nowhere else to be.",
  },
  {
    id: "two-of-us",
    title: "Two of Us",
    category: "Couples",
    duration: "29:12",
    quality: "HD",
    views: "2.0M",
    viewsNum: 2_000_000,
    added: "8 days ago",
    daysAgo: 8,
    rating: 98,
    thumb: px(5690191),
    alt: "Elegant couple standing close together in black and white",
    description:
      "An anniversary celebration that turns into a night neither will forget.",
  },
  {
    id: "sunset-suite",
    title: "Sunset Suite",
    category: "Amateur",
    duration: "16:58",
    quality: "HD",
    views: "864K",
    viewsNum: 864_000,
    added: "9 days ago",
    daysAgo: 9,
    rating: 91,
    thumb: px(29011561),
    alt: "Couple enjoying a golden evening overlooking the city",
    description:
      "Room service can wait. A golden-hour getaway in the penthouse suite.",
  },
  {
    id: "champagne-hours",
    title: "Champagne Hours",
    category: "Boudoir",
    duration: "20:12",
    quality: "4K",
    views: "1.3M",
    viewsNum: 1_300_000,
    added: "1 day ago",
    daysAgo: 1,
    rating: 96,
    thumb: px(36866113),
    alt: "Woman in a silk robe enjoying champagne in a luxurious hotel suite",
    description: "A suite, a bottle on ice, and absolutely nowhere to be in the morning.",
  },
  {
    id: "the-window-suite",
    title: "The Window Suite",
    category: "Solo",
    duration: "17:26",
    quality: "4K",
    views: "948K",
    viewsNum: 948_000,
    added: "1 day ago",
    daysAgo: 1,
    rating: 95,
    thumb: px(3940516),
    alt: "Woman in a long dress standing by the window of a modern hotel room",
    description: "Floor-to-ceiling glass, a quiet city below, and one long private evening.",
  },
  {
    id: "porcelain",
    title: "Porcelain",
    category: "Boudoir",
    duration: "22:03",
    quality: "4K",
    views: "1.6M",
    viewsNum: 1_600_000,
    added: "2 days ago",
    daysAgo: 2,
    rating: 97,
    thumb: px(6467854),
    alt: "Stylish woman seated on the edge of a luxurious bathtub",
    description: "Steam, marble and candlelight — a slow soak that turns into something more.",
  },
  {
    id: "the-lobby",
    title: "The Lobby",
    category: "Roleplay",
    duration: "25:41",
    quality: "HD",
    views: "782K",
    viewsNum: 782_000,
    added: "2 days ago",
    daysAgo: 2,
    rating: 93,
    thumb: px(3926207),
    alt: "Woman in a black dress seated elegantly in a classic hotel lobby",
    description: "She said she was waiting for someone. She never said who.",
  },
  {
    id: "beaded-curtain",
    title: "Beaded Curtain",
    category: "POV",
    duration: "19:34",
    quality: "HD",
    views: "655K",
    viewsNum: 655_000,
    added: "3 days ago",
    daysAgo: 3,
    rating: 92,
    thumb: px(7609199),
    alt: "Woman sitting pensively on a bed in a dimly lit room behind a beaded curtain",
    description: "Watched through strings of glass, in a room that keeps its secrets.",
  },
  {
    id: "gold-standard",
    title: "Gold Standard",
    category: "Mature 18+",
    duration: "23:58",
    quality: "4K",
    views: "1.9M",
    viewsNum: 1_900_000,
    added: "3 days ago",
    daysAgo: 3,
    rating: 98,
    thumb: px(6236178),
    alt: "Woman in a glamorous golden dress seated by a window at night",
    description: "Old money, new appetites — a nightcap that lasts until sunrise.",
  },
  {
    id: "neon-sign",
    title: "Neon Sign",
    category: "Kinky",
    duration: "21:47",
    quality: "4K",
    views: "2.1M",
    viewsNum: 2_100_000,
    added: "4 days ago",
    daysAgo: 4,
    rating: 97,
    thumb: px(14530804),
    alt: "Woman leaning against a glowing neon sign at night",
    description: "Electric light, electric mood. The street outside never notices.",
  },
  {
    id: "fur-and-fire",
    title: "Fur & Fire",
    category: "Mature 18+",
    duration: "26:19",
    quality: "4K",
    views: "1.4M",
    viewsNum: 1_400_000,
    added: "4 days ago",
    daysAgo: 4,
    rating: 96,
    thumb: px(16077169),
    alt: "Stylish woman in a fur coat under moody red lights at night",
    description: "Wrapped in fur, lit in red, and in no hurry to go indoors.",
  },
  {
    id: "red-glow",
    title: "Red Glow",
    category: "Kinky",
    duration: "18:55",
    quality: "4K",
    views: "1.1M",
    viewsNum: 1_100_000,
    added: "5 days ago",
    daysAgo: 5,
    rating: 95,
    thumb: px(36806859),
    alt: "Creative portrait of a woman illuminated by neon lights with a dramatic red glow",
    description: "A portrait session that stopped being about the portraits.",
  },
  {
    id: "scarlet-suit",
    title: "Scarlet Suit",
    category: "Roleplay",
    duration: "20:40",
    quality: "HD",
    views: "703K",
    viewsNum: 703_000,
    added: "5 days ago",
    daysAgo: 5,
    rating: 92,
    thumb: px(7817732),
    alt: "Woman in a red jumpsuit posing with a neon light at night",
    description: "She brought her own lighting. He brought everything else.",
  },
  {
    id: "blue-hour",
    title: "Blue Hour",
    category: "Romantic",
    duration: "24:27",
    quality: "4K",
    views: "1.7M",
    viewsNum: 1_700_000,
    added: "6 days ago",
    daysAgo: 6,
    rating: 96,
    thumb: px(7193841),
    alt: "Woman in a moody portrait with red and blue neon lighting",
    description: "Two colours, one room, and the longest hour of the night.",
  },
  {
    id: "corridor",
    title: "Corridor",
    category: "POV",
    duration: "16:12",
    quality: "HD",
    views: "589K",
    viewsNum: 589_000,
    added: "6 days ago",
    daysAgo: 6,
    rating: 91,
    thumb: px(32260697),
    alt: "Stylized portrait of a woman under red neon light in a dim corridor",
    description: "Room 304, end of the hall. She left the door open on purpose.",
  },
  {
    id: "city-lights",
    title: "City Lights",
    category: "Amateur",
    duration: "15:38",
    quality: "HD",
    views: "624K",
    viewsNum: 624_000,
    added: "7 days ago",
    daysAgo: 7,
    rating: 90,
    thumb: px(14797331),
    alt: "Young woman standing beside neon lights in an urban setting at night",
    description: "First date, last train missed — and neither of them minded.",
  },
  {
    id: "studio-session",
    title: "Studio Session",
    category: "Solo",
    duration: "22:50",
    quality: "4K",
    views: "1.2M",
    viewsNum: 1_200_000,
    added: "10 days ago",
    daysAgo: 10,
    rating: 94,
    thumb: px(6836008),
    alt: "Striking portrait of a woman in artistic neon lighting",
    description: "The lights went up, the crew went home, and the camera kept rolling.",
  },
  {
    id: "white-silk",
    title: "White Silk",
    category: "Massage",
    duration: "28:04",
    quality: "4K",
    views: "1.5M",
    viewsNum: 1_500_000,
    added: "12 days ago",
    daysAgo: 12,
    rating: 97,
    thumb: px(34631573),
    alt: "Woman in a white silk robe laughing in a beautifully designed room",
    description: "Warm oil, warmer hands, and an afternoon that never checks the clock.",
  },
  {
    id: "unwrapped",
    title: "Unwrapped",
    category: "Couples",
    duration: "19:21",
    quality: "HD",
    views: "836K",
    viewsNum: 836_000,
    added: "14 days ago",
    daysAgo: 14,
    rating: 93,
    thumb: px(10336051),
    alt: "Woman in a satin robe opening a gift on a hotel bed",
    description: "The present was a formality. The real surprise came later.",
  },
  {
    id: "lace-detail",
    title: "Lace Detail",
    category: "Boudoir",
    duration: "17:09",
    quality: "4K",
    views: "1.0M",
    viewsNum: 1_000_000,
    added: "17 days ago",
    daysAgo: 17,
    rating: 95,
    thumb: px(34362506),
    alt: "Close-up of a woman tying the belt of a white lace dressing gown",
    description: "Every knot is an invitation to untie it again.",
  },
];

/* ------------------------------------------------------------------ */
/* Home page promotion sets                                            */
/* ------------------------------------------------------------------ */

const byId = new Map(VIDEOS.map((v) => [v.id, v]));

/** The 20 scenes promoted in the home page Featured grid (4 rows × 5 columns). */
export const FEATURED_IDS: string[] = [
  "late-night-temptation", "morning-desire", "sensual-moments", "after-dark", "gold-standard",
  "neon-sign", "porcelain", "champagne-hours", "silk-shadows", "velvet-touch",
  "secret-rendezvous", "crimson-whisper", "blue-hour", "white-silk", "fur-and-fire",
  "two-of-us", "lace-detail", "red-glow", "the-window-suite", "midnight-confessions",
];

export const FEATURED_VIDEOS: Video[] = FEATURED_IDS.map((id) => byId.get(id)).filter(
  (v): v is Video => Boolean(v)
);

const featuredSet = new Set(FEATURED_IDS);
VIDEOS.forEach((v) => {
  v.featured = featuredSet.has(v.id);
});

/** Newest uploads first — the home page shows the first 16 (4 rows × 4 columns). */
export const LATEST_VIDEOS: Video[] = [...VIDEOS].sort((a, b) => a.daysAgo - b.daysAgo);
