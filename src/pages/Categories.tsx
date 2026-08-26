import { LayoutGrid } from "lucide-react";
import { CATEGORIES, categoryCount, TOTAL_VIDEOS } from "@/data/videos";
import { CategoryCard } from "@/components/Sections";
import { useSEO } from "@/lib/seo";

export default function Categories() {
  useSEO({
    title: "Adult Video Categories — EroBabe",
    description:
      "Browse every 18+ video category on EroBabe — studio productions, premium, couples, solo, amateur, compilations and curated collections.",
  });
  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-6 animate-fade-up md:mb-8">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white md:text-3xl">
          <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/25 to-violet-600/25 ring-1 ring-brand-500/30">
            <LayoutGrid className="size-5 text-brand-300" aria-hidden />
          </span>
          Categories
        </h1>
        <p className="mt-2 text-sm text-fog-500">
          {TOTAL_VIDEOS} videos across {CATEGORIES.filter((c) => !c.href).length} categories — plus curated collections.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 animate-fade-up sm:gap-4 lg:grid-cols-3">
        {CATEGORIES.map((c) => (
          <CategoryCard key={c.slug} category={c} count={c.href ? undefined : categoryCount(c.slug)} />
        ))}
      </div>
    </div>
  );
}
