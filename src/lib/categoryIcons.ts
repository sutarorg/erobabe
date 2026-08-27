import {
  Award, Bed, Cake, Camera, Clapperboard, Crown, Droplets, Eye, Flame, Flower2,
  Gem, Ghost, Hand, HandHeart, Heart, Layers, Lock, Moon, Music, Sparkles, Star,
  Sun, TrendingUp, Users, Venus, Video, Wine, Zap, type LucideIcon,
} from "lucide-react";

/**
 * Central category-icon registry.
 *
 * Icons are stored as short stable keys (`categories.icon` in the database),
 * so the public site and the CMS always resolve the same glyph. Add an entry
 * here and it is instantly available everywhere.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  "trending-up": TrendingUp,
  sparkles: Sparkles,
  camera: Camera,
  zap: Zap,
  cake: Cake,
  hand: Hand,
  venus: Venus,
  users: Users,
  moon: Moon,
  droplets: Droplets,
  flower: Flower2,
  "hand-heart": HandHeart,
  sun: Sun,
  heart: Heart,
  crown: Crown,
  gem: Gem,
  star: Star,
  bed: Bed,
  wine: Wine,
  // Extra glyphs available to the data layer / future picker additions.
  layers: Layers,
  clapperboard: Clapperboard,
  video: Video,
  lock: Lock,
  eye: Eye,
  music: Music,
  ghost: Ghost,
  award: Award,
};

export const DEFAULT_CATEGORY_ICON: LucideIcon = Layers;

/** Built-in defaults so shipped categories always have a recognizable glyph. */
export const ICON_BY_SLUG: Record<string, string> = {
  trending: "flame",
  popular: "trending-up",
  new: "sparkles",
  amateur: "camera",
  hardcore: "zap",
  "young-18": "cake",
  masturbation: "hand",
  lesbian: "venus",
  threesome: "users",
  ebony: "moon",
  creampie: "droplets",
  asian: "flower",
  massage: "hand-heart",
  blonde: "sun",
};

/**
 * The 20 icon choices offered in the CMS category editor. Rendered as
 * icon-only tiles; `represents` powers the tooltip and screen-reader label.
 */
export const ICON_OPTIONS: { key: string; label: string; represents: string }[] = [
  { key: "flame", label: "Flame", represents: "Trending / hot" },
  { key: "trending-up", label: "Trend line", represents: "Popular" },
  { key: "sparkles", label: "Sparkles", represents: "New releases" },
  { key: "camera", label: "Camera", represents: "Amateur" },
  { key: "zap", label: "Bolt", represents: "Hardcore" },
  { key: "cake", label: "Cake", represents: "Young 18+" },
  { key: "hand", label: "Hand", represents: "Masturbation" },
  { key: "venus", label: "Venus", represents: "Lesbian" },
  { key: "users", label: "Group", represents: "Threesome" },
  { key: "moon", label: "Moon", represents: "Ebony" },
  { key: "droplets", label: "Droplets", represents: "Creampie" },
  { key: "flower", label: "Blossom", represents: "Asian" },
  { key: "hand-heart", label: "Caring hands", represents: "Massage" },
  { key: "sun", label: "Sun", represents: "Blonde" },
  { key: "heart", label: "Heart", represents: "Romantic" },
  { key: "crown", label: "Crown", represents: "Premium" },
  { key: "gem", label: "Gem", represents: "Exclusive" },
  { key: "star", label: "Star", represents: "Featured" },
  { key: "bed", label: "Bed", represents: "Bedroom" },
  { key: "wine", label: "Wine", represents: "Date night" },
];

/** Resolve a category glyph: explicit icon key → slug default → fallback. */
export function resolveCategoryIcon(slug?: string | null, icon?: string | null): LucideIcon {
  if (icon && CATEGORY_ICONS[icon]) return CATEGORY_ICONS[icon];
  const bySlug = slug ? ICON_BY_SLUG[slug] : undefined;
  if (bySlug && CATEGORY_ICONS[bySlug]) return CATEGORY_ICONS[bySlug];
  return DEFAULT_CATEGORY_ICON;
}
