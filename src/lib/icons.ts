/**
 * Central category-icon registry — the single source of truth shared by the
 * public site (Explore, category pages, cards, sidebar) and the admin CMS
 * icon picker. Storing only the string `icon` key keeps state serializable.
 */
import {
  Camera, Crown, Flame, Flower2, Hand, HeartHandshake, IceCreamCone,
  Moon, Sparkles, Sprout, Sun, Tag, Users, Waves, Zap,
} from "lucide-react";

export type CategoryIconComponent = typeof Flame;

/** Every registered icon, keyed by a stable serializable id. */
export const ICON_REGISTRY: Record<string, CategoryIconComponent> = {
  flame: Flame,
  crown: Crown,
  sparkles: Sparkles,
  camera: Camera,
  zap: Zap,
  sprout: Sprout,
  hand: Hand,
  hearts: HeartHandshake,
  users: Users,
  moon: Moon,
  icecream: IceCreamCone,
  flower: Flower2,
  waves: Waves,
  sun: Sun,
};

/** Resolve a stored icon key to a Lucide component (safe fallback: Tag). */
export function getCategoryIcon(key?: string): CategoryIconComponent {
  return (key && ICON_REGISTRY[key]) || Tag;
}

/**
 * The 9 selectable options offered in the admin category editor. Each is
 * chosen to visually represent the kind of category it will be assigned to.
 */
export const ADMIN_ICON_CHOICES: { key: string; label: string; hint: string }[] = [
  { key: "flame", label: "Flame", hint: "Trending / hot" },
  { key: "crown", label: "Crown", hint: "Popular / premium" },
  { key: "sparkles", label: "Sparkles", hint: "New / fresh drops" },
  { key: "camera", label: "Camera", hint: "Amateur / self-shot" },
  { key: "zap", label: "Lightning", hint: "Hardcore / intense" },
  { key: "sprout", label: "Sprout", hint: "Young / new faces" },
  { key: "hand", label: "Hand", hint: "Solo / masturbation" },
  { key: "hearts", label: "Hearts", hint: "Lesbian / romance" },
  { key: "users", label: "Group", hint: "Threesome / group" },
];
