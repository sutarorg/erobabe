import type { LucideIcon } from "lucide-react";
import { resolveCategoryIcon } from "./categoryIcons";

/**
 * Renders a category's icon.
 *
 * No hooks, so it is safe inside server components (the `/categories` index)
 * as well as client ones (the homepage category strip).
 */
interface CategoryIconProps {
  /** Value of the `categories.icon` column, or a Lucide component. */
  icon?: LucideIcon | string | null;
  /** Category slug or label, used when no icon name is stored. */
  fallbackKey?: string | null;
  className?: string;
  strokeWidth?: number;
}

export default function CategoryIcon({ icon, fallbackKey, className, strokeWidth = 1.8 }: CategoryIconProps) {
  const Icon = resolveCategoryIcon(icon, fallbackKey);
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden />;
}

export { resolveCategoryIcon, CATEGORY_ICONS } from "./categoryIcons";
