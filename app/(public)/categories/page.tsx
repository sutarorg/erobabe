import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SITE_URL } from "@/lib/site";
import { getPublicCategories } from "@/lib/public/catalog";
import CategoryIcon from "@/src/components/CategoryIcon";
import type { Metadata } from "next";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "All Categories",
  alternates: { canonical: `${SITE_URL}/categories` },
};

export default async function CategoriesPage() {
  const categories = await getPublicCategories();

  return (
    <div className="pt-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Browse</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">All Categories</h1>
        <span className="text-[12px] tabular-nums text-ink-3">{categories.length} categories</span>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        Explore the library by what you love — every category is hand-curated and updated daily.
      </p>

      {/* Four cards across in the center panel, with fewer columns on small screens. */}
      <div className="mt-6 grid grid-cols-2 auto-rows-fr gap-3 @md:grid-cols-3 @lg:grid-cols-4">
        {categories.map((cat) => {
          const videoCount = cat.video_count || 0;
          return (
            <Link
              key={cat.id}
              href={`/category/${cat.slug}`}
              prefetch
              aria-label={`Browse ${cat.label}, ${videoCount} ${videoCount === 1 ? "video" : "videos"}`}
              className="group relative flex min-h-[132px] min-w-0 flex-col items-start rounded-xl border border-line bg-card p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/45 hover:bg-card-hover"
            >
              <div className="flex w-full items-start justify-between gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 transition-colors group-hover:border-accent/45 group-hover:bg-accent/15">
                  <CategoryIcon
                    icon={cat.icon}
                    fallbackKey={cat.slug || cat.label}
                    className="h-[18px] w-[18px] text-accent transition-transform duration-200 group-hover:scale-110"
                  />
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-3 opacity-0 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent group-hover:opacity-100" aria-hidden />
              </div>
              <span className="mt-3 block w-full break-words text-[13px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
                {cat.label}
              </span>
              <span className="mt-1.5 text-[11px] font-medium text-ink-3">
                {videoCount} {videoCount === 1 ? "video" : "videos"}
              </span>
            </Link>
          );
        })}
      </div>

      {categories.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-line p-8 text-center">
          <p className="text-[14px]">No categories yet</p>
        </div>
      )}
    </div>
  );
}
