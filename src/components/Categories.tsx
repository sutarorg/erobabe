"use client";
import { useRouter } from "next/navigation";
import { CATEGORIES as MOCK_CATEGORIES, categorySlug } from "../data/content";
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
  categories?: CategoryInput[];
}

export default function Categories({ activeCategory = null, onSelect, categories }: CategoriesProps = {}) {
  const router = useRouter();
  const list = categories && categories.length > 0 ? categories : MOCK_CATEGORIES;

  const select = (cat: CategoryInput) => {
    if (onSelect) {
      onSelect(cat.label);
      return;
    }
    router.push(`/category/${cat.slug || categorySlug(cat.label)}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Top Categories</h2>
      </div>

      <div className="mt-3.5 grid grid-cols-4 gap-2.5 @2xl:grid-cols-8">
        {list.map((cat) => {
          const Icon = resolveCategoryIcon(cat.icon, cat.slug || cat.label);
          const active = activeCategory === cat.label;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => select(cat)}
              aria-pressed={active}
              className={cn(
                "group flex h-[82px] flex-col items-center justify-center gap-2 rounded-lg border bg-card transition-colors duration-150",
                active
                  ? "border-accent/70 bg-accent/8"
                  : "border-line hover:border-accent/45 hover:bg-card-hover"
              )}
            >
              <Icon
                className="h-5 w-5 text-accent transition-transform duration-200 group-hover:scale-110"
                strokeWidth={1.8}
                aria-hidden
              />
              <span className="text-[12px] font-medium leading-none text-zinc-200">
                {cat.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
