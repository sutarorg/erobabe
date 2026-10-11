"use client";
import { ArrowRight } from "lucide-react";
import { ALL_CATEGORIES } from "../data/content";

interface CategoriesPageProps {
  onSelect: (label: string) => void;
}

/** /categories — full category index of the public site. */
export default function CategoriesPage({ onSelect }: CategoriesPageProps) {
  const tiles = ALL_CATEGORIES;
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 @sm:px-5 @2xl:px-7">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Browse</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">All Categories</h1>
        <span className="text-[12px] tabular-nums text-ink-3">{tiles.length} categories</span>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        Explore the library by what you love — every category is hand-curated and updated daily.
      </p>

      {/* Three columns at every width — four even rows of three cards. */}
      <div className="mt-5 grid grid-cols-3 auto-rows-fr gap-3">
        {tiles.map((cat) => {
          const Icon = cat.icon;
          const name = cat.label;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(cat.label)}
              aria-label={`Browse ${name}`}
              className="group rounded-xl border border-line bg-card p-4 text-left transition-colors hover:border-accent/45 hover:bg-[#17171b]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
                <Icon className="h-5 w-5 text-accent" strokeWidth={1.8} aria-hidden />
              </span>
              <span className="mt-3 block text-[14px] font-semibold text-ink">{name}</span>
              <span className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-accent opacity-0 transition-opacity group-hover:opacity-100">
                Browse
                <ArrowRight className="h-3 w-3" aria-hidden />
              </span>
            </button>
          );
        })}

      </div>
    </div>
  );
}
