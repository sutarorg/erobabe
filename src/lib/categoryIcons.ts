import {
  Cake, Camera, Droplets, Flame, Flower2, Hand, HandHeart, Heart, Layers,
  Moon, Sparkles, Sun, TrendingUp, Users, Venus, Zap, type LucideIcon,
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
  layers: Layers,
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
 * The nine icon choices offered in the CMS category editor. Each one is
 * paired with the category type it visually represents.
 */
export const ICON_OPTIONS: { key: string; label: string; represents: string }[] = [
  { key: "flame", label: "Flame", represents: "Trending / hot" },
  { key: "sparkles", label: "Sparkles", represents: "New releases" },
  { key: "camera", label: "Camera", represents: "Amateur" },
  { key: "zap", label: "Bolt", represents: "Hardcore" },
  { key: "users", label: "Group", represents: "Threesome" },
  { key: "venus", label: "Venus", represents: "Lesbian" },
  { key: "droplets", label: "Droplets", represents: "Creampie" },
  { key: "flower", label: "Blossom", represents: "Asian" },
  { key: "hand-heart", label: "Caring hands", represents: "Massage" },
];

/** Resolve a category glyph: explicit icon key → slug default → fallback. */
export function resolveCategoryIcon(slug?: string | null, icon?: string | null): LucideIcon {
  if (icon && CATEGORY_ICONS[icon]) return CATEGORY_ICONS[icon];
  const bySlug = slug ? ICON_BY_SLUG[slug] : undefined;
  if (bySlug && CATEGORY_ICONS[bySlug]) return CATEGORY_ICONS[bySlug];
  return DEFAULT_CATEGORY_ICON;
}
