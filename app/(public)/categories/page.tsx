import { publicPageMetadata } from "@/lib/metadata/page";
import Link from "next/link";
import { SITE_URL } from "@/lib/site";
import { getPublicCategories } from "@/lib/public/catalog";
import Breadcrumbs from "@/src/components/Breadcrumbs";
import JsonLd from "@/src/components/JsonLd";
import { collectionPageJsonLd } from "@/lib/seo/json-ld";
import type { Metadata } from "next";

export const revalidate = 60;

export const metadata: Metadata = publicPageMetadata({
  title: "All Categories",
  description: "Explore Erobabe video categories to find relevant collections and discover published videos by interest. This catalog is exclusively for adults aged 18 and over.",
  alternates: { canonical: `${SITE_URL}/categories` },
});

export default async function CategoriesPage() {
  const categories = await getPublicCategories();

  return (
    <div className="pt-4">
      <JsonLd
        data={collectionPageJsonLd({
          name: "All Categories",
          description: "Explore Erobabe video categories to find published adult videos by interest. 18+ only.",
          path: "/categories",
        })}
      />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Categories", path: "/categories" }]} />
      <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Browse</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">All Categories</h1>
        <span className="text-[12px] tabular-nums text-ink-3">{categories.length} categories</span>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        Explore the library by what you love — every category is hand-curated and updated daily.
      </p>

      {/* Four cards across in the center panel, with fewer columns on small screens. */}
      <div className="mt-6 grid grid-cols-2 auto-rows-fr gap-3 @md:grid-cols-3 @lg:grid-cols-4">
        {categories.map((cat) => (
          <Link
            key={cat.id}
            href={`/category/${cat.slug}`}
            prefetch
            aria-label={`Browse ${cat.label}`}
            className="group relative flex min-h-[132px] min-w-0 flex-col items-start justify-end overflow-hidden rounded-xl border border-line bg-card p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/45 hover:bg-card-hover"
          >
            {/* Admin-uploaded card thumbnail, when one is set. */}
            {cat.image_url ? (
              <img
                src={cat.image_url}
                alt={`${cat.label} videos`}
                loading="lazy"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50 transition-opacity duration-200 group-hover:opacity-65"
              />
            ) : null}

            {/* Dark back gradient overlay to ensure category name is clearly visible */}
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"
              aria-hidden="true"
            />

            <span className="relative z-10 block w-full break-words text-[13.5px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
              {cat.label}
            </span>
          </Link>
        ))}
      </div>

      {categories.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-line p-8 text-center">
          <p className="text-[14px]">No categories yet</p>
        </div>
      )}
    </div>
  );
}
