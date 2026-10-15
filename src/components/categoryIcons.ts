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

/**
 * Single source of truth for category artwork.
 *
 * The `categories.icon` column stores a plain string so the value can cross the
 * server/client boundary; both the homepage strip (`src/components/Categories`)
 * and the `/categories` index resolve it through this map.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  camera: Camera,
  eye: Eye,
  users: Users,
  mask: VenetianMask,
  "venetian-mask": VenetianMask,
  wine: Wine,
  heart: Heart,
  "heart-handshake": HeartHandshake,
  sparkles: Sparkles,
  user: UserRound,
  "user-round": UserRound,
  drama: Drama,
  flower: Flower2,
  "flower-2": Flower2,
  grid: LayoutGrid,
  "layout-grid": LayoutGrid,
};

/** Used when a category has no `icon` value stored. */
const ICON_BY_SLUG: Record<string, LucideIcon> = {
  milf: Wine,
  japanese: Flower2,
  "teen-18plus": Sparkles,
  hentai: Drama,
  ebony: UserRound,
  "big-ass": Flame,
  threesome: Users,
  hardcore: VenetianMask,
  mature: Flame,
  amateur: Camera,
  pov: Eye,
  lesbian: Users,
  kinky: VenetianMask,
  "mature-18plus": Wine,
  "mature-18": Wine,
  couples: HeartHandshake,
  boudoir: Sparkles,
  romantic: Heart,
  solo: UserRound,
  roleplay: Drama,
  massage: Flower2,
};

/**
 * Lucide icons are `React.forwardRef` objects, not plain functions, so a
 * `typeof icon === "function"` check silently drops them and every category
 * falls back to the same icon. Accept any renderable React component.
 */
function isReactComponent(value: unknown): value is LucideIcon {
  if (typeof value === "function") return true;
  return typeof value === "object" && value !== null && "$$typeof" in (value as Record<string, unknown>);
}

export function resolveCategoryIcon(icon?: LucideIcon | string | null, fallbackKey?: string | null): LucideIcon {
  if (isReactComponent(icon)) return icon;
  if (typeof icon === "string") {
    const byName = CATEGORY_ICONS[icon.trim().toLowerCase()];
    if (byName) return byName;
  }
  const key = (fallbackKey || "").trim().toLowerCase();
  return ICON_BY_SLUG[key] || Flame;
}
