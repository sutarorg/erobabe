import { SITE_URL } from "@/lib/site";
import Link from "next/link";
import Categories from "@/src/components/Categories";
import Hero from "@/src/components/Hero";
import VideoSection from "@/src/components/VideoSection";
import InlineAd from "@/src/components/InlineAd";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import FourRowVideoGrid from "@/src/components/FourRowVideoGrid";
import { getCarouselVideos, getPublicCategories, getPublishedVideos } from "@/lib/public/catalog";
import { LOGO_URL, type HeroSlide } from "@/src/data/content";
import type { Metadata } from "next";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "erobabe — Premium Adult Entertainment",
  description: "Your destination for discovering premium adult entertainment. 18+ adults only.",
  alternates: { canonical: SITE_URL },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [videos, categories, carousel] = await Promise.all([
    getPublishedVideos(),
    getPublicCategories(),
    getCarouselVideos(),
  ]);
  const heroSlides: HeroSlide[] = carousel.map((video) => ({
    id: video.slug,
    eyebrow: video.category_label || "Featured",
    headline: video.title,
    sub: video.description || "Watch the full scene now.",
    image: video.thumbnail_url || LOGO_URL,
    alt: video.title,
    href: `/video/${video.slug}`,
  }));
  const query = q?.trim() || "";
  const mappedVideos = query
    ? videos.filter((video) => video.title.toLowerCase().includes(query.toLowerCase()))
    : videos;

  const featuredVideos = mappedVideos.slice(0, 16);
  const latestVideos = mappedVideos.slice(0, 16);
  const categoryCards = categories.map((category) => ({
    id: category.id,
    label: category.label,
    slug: category.slug,
    icon: category.icon || undefined,
    image: category.image_url || undefined,
  }));

  if (query) {
    return (
      <div className="pt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Search</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Results for “{query}”</h1>
          <span className="text-[12px] tabular-nums text-ink-3">{mappedVideos.length} videos found</span>
        </div>
        <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
          Explore matching scenes across our hand-curated library.
        </p>
        {mappedVideos.length === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-card p-8 text-center">
            <p className="text-[14px] font-medium">No videos found</p>
            <p className="mt-1 text-[12.5px] text-ink-3">Try a different search term or browse categories.</p>
            <Link href="/" prefetch className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft">
              Back to home
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 @md:grid-cols-3 @lg:grid-cols-4">
            {mappedVideos.map((video) => (
              <PublicVideoCard key={video.slug} video={video} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (mappedVideos.length === 0) {
    return (
      <div className="pt-4">
        <Hero slides={heroSlides} />
        <section className="mt-7">
          <Categories activeCategory={null} categories={categoryCards} />
        </section>
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[16px] font-semibold">No videos published yet</p>
          <p className="mt-2 text-[13px] text-ink-3">The library is being prepared. Check back soon for premium content.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4">
      <Hero slides={heroSlides} />

      <section className="mt-7">
        <Categories activeCategory={null} categories={categoryCards} />
      </section>

      <section className="mt-8">
        <VideoSection title="Featured Videos">
          <FourRowVideoGrid className="video-grid mt-3.5">
            {featuredVideos.map((video) => (
              <PublicVideoCard key={video.slug} video={video} />
            ))}
          </FourRowVideoGrid>
        </VideoSection>
      </section>

      <div className="mt-8">
        <InlineAd />
      </div>

      <section className="mt-8">
        <VideoSection title="Latest Videos">
          <FourRowVideoGrid className="video-grid mt-3.5">
            {latestVideos.map((video) => (
              <PublicVideoCard key={video.slug} video={video} />
            ))}
          </FourRowVideoGrid>
        </VideoSection>
      </section>
    </div>
  );
}
