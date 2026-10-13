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
  /** Admin-uploaded card thumbnail URL. Replaces the icon when present. */
  image?: string | null;
}

interface CategoriesProps {
  activeCategory?: string | null;
  /** Optional — falls back to client-side navigation to /category/[slug]. */
  onSelect?: (label: string) => void;
  /** Optional SPA navigation for the final More card. */
  onMore?: () => void;
  categories?: CategoryInput[];
}

const FEATURED_HOME_CATEGORIES = HOME_CATEGORIES.filter((category) => category.id !== "more").slice(0, 7);
const MORE_CATEGORY = HOME_CATEGORIES.find((category) => category.id === "more")!;

/**
 * Homepage category list: keep seven featured categories in the designed
 * order, then add More as the eighth and final card to open the full
 * category index. Database metadata is used when available; the seeded
 * taxonomy remains a safe visual fallback while public data is loading or
 * unconfigured.
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

      {/*
        Exactly one row: all eight cards (seven featured + More) share a single
        eight-column track at every container width, and the cards are compact
        enough — icon above label — to fit without horizontal scrolling.
      */}
      <div className="category-grid mt-3.5 grid grid-cols-8 gap-1 @md:gap-1.5 @2xl:gap-2.5">
        {list.map((cat) => {
          const isMore = cat.label.trim().toLowerCase() === "more";
          const Icon = resolveCategoryIcon(cat.icon, cat.slug || cat.label);
          const active = !isMore && activeCategory === cat.label;
          const className = cn(
            // Compact vertical cards keep all eight categories on one row
            // without horizontal scrolling in the center content panel.
            "group flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border px-0 py-1.5 text-center transition-colors duration-150 @sm:min-h-[68px] @sm:gap-2 @sm:px-0.5 @sm:py-2 @md:px-1 @2xl:min-h-[76px]",
            active
              ? "border-accent/70 bg-accent/8"
              : "border-line bg-card hover:border-accent/45 hover:bg-card-hover"
          );
          const inner = (
            <>
              {cat.image ? (
                // Admin-uploaded category thumbnail (same box as the icon, so
                // the eight-card row keeps its geometry).
                <img
                  src={cat.image}
                  alt=""
                  loading="lazy"
                  className="h-4 w-4 shrink-0 rounded object-cover transition-transform duration-200 group-hover:scale-110 @sm:h-5 @sm:w-5"
                />
              ) : (
                <Icon
                  className="h-4 w-4 shrink-0 text-accent transition-transform duration-200 group-hover:scale-110 @sm:h-5 @sm:w-5"
                  strokeWidth={1.8}
                  aria-hidden
                />
              )}
              <span
                className="line-clamp-2 w-full break-words text-[8px] font-medium leading-[1.25] text-zinc-200 @sm:text-[9px] @md:text-[11px] @2xl:text-[12px]"
                title={cat.label}
              >
                {cat.label}
              </span>
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
