"use client";
import Link from "next/link";
import { CATEGORIES as HOME_CATEGORIES, categorySlug } from "../data/content";
import { cn } from "../utils/cn";
import type { LucideIcon } from "lucide-react";
import { resolveCategoryIcon } from "./categoryIcons";

interface CategoryInput {
  id: string;
  label: string;
  slug?: string;
  /** Lucide component (client-only data) or the icon name stored in Supabase. */
  icon?: LucideIcon | string;
}

interface CategoriesProps {
  activeCategory?: string | null;
  /** Optional — falls back to client-side navigation to /category/[slug]. */
  onSelect?: (label: string) => void;
  /** Optional SPA navigation for the final More card. */
  onMore?: () => void;
  categories?: CategoryInput[];
}

const FEATURED_HOME_CATEGORIES = HOME_CATEGORIES.filter((category) => category.id !== "more").slice(0, 6);
const MORE_CATEGORY = HOME_CATEGORIES.find((category) => category.id === "more")!;

/**
 * Homepage category list: keep six featured categories in the designed
 * order, then add More as the seventh row to open the full category index.
 * Database metadata is used when available; the seeded taxonomy remains a
 * safe visual fallback while public data is loading or unconfigured.
 */
function homeCategoryList(categories?: CategoryInput[]): CategoryInput[] {
  const supplied = categories || [];
  const featured = FEATURED_HOME_CATEGORIES.map((fallback) =>
    supplied.find((category) => category.label.trim().toLowerCase() === fallback.label.toLowerCase()) || fallback
  );
  const more = supplied.find((category) => category.label.trim().toLowerCase() === "more") || MORE_CATEGORY;
  return [...featured, more];
}

export default function Categories({ activeCategory = null, onSelect, onMore, categories }: CategoriesProps = {}) {
  const list = homeCategoryList(categories);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Top Categories</h2>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-2.5">
        {list.map((cat) => {
          const isMore = cat.label.trim().toLowerCase() === "more";
          const Icon = resolveCategoryIcon(cat.icon, cat.slug || cat.label);
          const active = !isMore && activeCategory === cat.label;
          const className = cn(
            "group flex h-[64px] items-center justify-start gap-3 rounded-lg border px-4 transition-colors duration-150",
            active
              ? "border-accent/70 bg-accent/8"
              : "border-line bg-card hover:border-accent/45 hover:bg-card-hover"
          );
          const inner = (
            <>
              <Icon
                className="h-5 w-5 shrink-0 text-accent transition-transform duration-200 group-hover:scale-110"
                strokeWidth={1.8}
                aria-hidden
              />
              <span className="text-[12px] font-medium leading-none text-zinc-200">{cat.label}</span>
            </>
          );

          if (isMore && onMore) {
            return (
              <button key={cat.id} type="button" onClick={onMore} className={className}>
                {inner}
              </button>
            );
          }

          if (!onSelect || isMore) {
            return (
              <Link
                key={cat.id}
                href={isMore ? "/categories" : `/category/${cat.slug || categorySlug(cat.label)}`}
                prefetch
                aria-current={active ? "page" : undefined}
                className={className}
              >
                {inner}
              </Link>
            );
          }

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(cat.label)}
              aria-pressed={active}
              className={className}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
