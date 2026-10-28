import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { getCategoryBySlug } from "@/lib/public/catalog";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import Breadcrumbs from "@/src/components/Breadcrumbs";
import JsonLd from "@/src/components/JsonLd";
import { collectionPageJsonLd } from "@/lib/seo/json-ld";
import { publicPageMetadata } from "@/lib/metadata/page";
import type { Metadata } from "next";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { category, videos } = await getCategoryBySlug(slug);
  if (!category) notFound();
  const description =
    category.description ||
    `Browse ${category.label} adult videos on erobabe. ${videos.length} published scene${videos.length === 1 ? "" : "s"}. 18+ only.`;
  return publicPageMetadata({
    title: `${category.label} Videos`,
    description,
    robots: { index: videos.length > 0, follow: true },
    openGraph: {
      title: `${category.label} Videos`,
      description,
      url: `${SITE_URL}/category/${slug}`,
    },
    alternates: { canonical: `${SITE_URL}/category/${slug}` },
  });
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { category, videos } = await getCategoryBySlug(slug);
  if (!category) notFound();

  const description =
    category.description || `Explore hand-curated ${category.label.toLowerCase()} scenes updated daily.`;

  return (
    <div className="pt-4">
      <JsonLd
        data={collectionPageJsonLd({
          name: `${category.label} Videos`,
          description,
          path: `/category/${slug}`,
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Categories", path: "/categories" },
          { name: category.label, path: `/category/${slug}` },
        ]}
      />
      <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Category</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">{category.label}</h1>
        <span className="text-[12px] tabular-nums text-ink-3">{videos.length} videos</span>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        {category.description || `Explore hand-curated ${category.label.toLowerCase()} scenes updated daily.`}
      </p>

      {videos.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[14px] font-medium">No videos in this category yet</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Check back later for new content.</p>
          <Link href="/categories" prefetch className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white">
            View all categories
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 @md:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4">
          {videos.map((video) => (
            <PublicVideoCard key={video.slug} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
