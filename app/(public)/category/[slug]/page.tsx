import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { getCategoryBySlug } from "@/lib/public/catalog";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import type { Metadata } from "next";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { category } = await getCategoryBySlug(slug);
  if (!category) return { title: "Category not found" };
  return {
    title: `${category.label} Videos`,
    alternates: { canonical: `${SITE_URL}/category/${slug}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { category, videos } = await getCategoryBySlug(slug);
  if (!category) notFound();

  return (
    <div className="pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">Category</p>
      <h1 className="mt-1 text-[22px] font-semibold tracking-tight">{category.label}</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">{videos.length} videos</p>

      {videos.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[14px] font-medium">No videos in this category yet</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Check back later for new content.</p>
          <Link href="/browser" prefetch className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white">
            Browse all videos
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {videos.map((video) => (
            <PublicVideoCard key={video.slug} video={video} subtitle={`${video.view_count || 0} views`} />
          ))}
        </div>
      )}
    </div>
  );
}
