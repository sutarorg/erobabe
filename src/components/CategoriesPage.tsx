"use client";
import { ALL_CATEGORIES } from "../data/content";

interface CategoriesPageProps {
  onSelect: (label: string) => void;
}

/** /categories — full category index of the public site. */
export default function CategoriesPage({ onSelect }: CategoriesPageProps) {
  const tiles = ALL_CATEGORIES;
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 @sm:px-5 @2xl:px-7">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Browse</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">All Categories</h1>
        <span className="text-[12px] tabular-nums text-ink-3">{tiles.length} categories</span>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        Explore the library by what you love — every category is hand-curated and updated daily.
      </p>

      {/* Three columns at every width — four even rows of three cards. */}
      <div className="mt-5 grid grid-cols-3 auto-rows-fr gap-3">
        {tiles.map((cat) => {
          const name = cat.label;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(cat.label)}
              aria-label={`Browse ${name}`}
              className="group relative flex min-h-[132px] min-w-0 flex-col items-start justify-end overflow-hidden rounded-xl border border-line bg-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/45 hover:bg-card-hover"
            >
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"
                aria-hidden="true"
              />
              <span className="relative z-10 block w-full break-words text-[14px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
