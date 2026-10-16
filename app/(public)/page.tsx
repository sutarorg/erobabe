import { publicPageMetadata } from "@/lib/metadata/page";
import { homeSections } from "@/lib/public/selection";
import { getRecommendationFeed } from "@/lib/recommendations/service";
import RecommendationShelf from "@/src/components/RecommendationShelf";

import { heroSlidesFromCarousel } from "@/lib/public/hero-slides";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";
import Categories from "@/src/components/Categories";
import Hero from "@/src/components/Hero";
import VideoSection from "@/src/components/VideoSection";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import FourRowVideoGrid from "@/src/components/FourRowVideoGrid";
import {
  getCarouselVideos,
  getPublicCategories,
  getPublishedVideos,
  searchPublishedVideos,
} from "@/lib/public/catalog";
import { LOGO_URL } from "@/src/data/content";
import type { Metadata } from "next";

export const revalidate = 30;

export const metadata: Metadata = publicPageMetadata({
  title: "erobabe — Premium Adult Entertainment",
  description:
    "Your destination for discovering premium adult entertainment. 18+ adults only.",
  alternates: { canonical: SITE_URL },
});

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
  // The carousel card prints the short AI copy stored when the admin placed the
  // video in its slot (max 5 words / max 10 words), never the full listing title.
  const heroSlides = heroSlidesFromCarousel(carousel, LOGO_URL);
  const query = q?.trim().slice(0, 160) || "";
  const mappedVideos = query ? await searchPublishedVideos(query) : videos;

  const { latest: latestVideos } = homeSections(mappedVideos);
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
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">
          Search
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight">
            Results for “{query}”
          </h1>
          <span className="text-[12px] tabular-nums text-ink-3">
            {mappedVideos.length} videos found
          </span>
        </div>
        <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
          Explore matching scenes across our hand-curated library.
        </p>
        {mappedVideos.length === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-card p-8 text-center">
            <p className="text-[14px] font-medium">No videos found</p>
            <p className="mt-1 text-[12.5px] text-ink-3">
              Try a different search term or browse categories.
            </p>
            <Link
              href="/"
              prefetch
              className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft"
            >
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

  const [featuredFeed, recommendedFeed] = await Promise.all([
    getRecommendationFeed({ surface: "featured", limit: 12 }),
    getRecommendationFeed({ surface: "recommended", limit: 12 }),
  ]);
  const excludedSlugs = new Set([...latestVideos.map((video) => video.slug), ...carousel.map((video) => video.slug)]);
  const featuredVideos = featuredFeed.videos.filter((video) => !excludedSlugs.has(video.slug));
  const recommendedVideos = recommendedFeed.videos.filter((video) => !excludedSlugs.has(video.slug) && !featuredVideos.some((item) => item.slug === video.slug));

  if (mappedVideos.length === 0) {
    return (
      <div className="pt-4">
        <Hero slides={heroSlides} />
        <section className="mt-7">
          <Categories activeCategory={null} categories={categoryCards} />
        </section>
        <div className="mt-8 rounded-lg border border-dashed border-line bg-card p-12 text-center">
          <p className="text-[16px] font-semibold">No videos published yet</p>
          <p className="mt-2 text-[13px] text-ink-3">
            The library is being prepared. Check back soon for premium content.
          </p>
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

      <RecommendationShelf title="Featured Videos" videos={featuredVideos} surface="featured" correlationId={featuredFeed.correlationId} algorithmVersion={featuredFeed.algorithmVersion} />
      <section className="mt-8">
        <VideoSection title="Latest Videos">
          <FourRowVideoGrid className="video-grid mt-3.5">
            {latestVideos.map((video) => (
              <PublicVideoCard key={video.slug} video={video} />
            ))}
          </FourRowVideoGrid>
        </VideoSection>
      </section>
      <RecommendationShelf
        title={recommendedFeed.personalized ? "Recommended for you" : "Discover videos"}
        videos={recommendedVideos}
        surface="recommended"
        correlationId={recommendedFeed.correlationId}
        algorithmVersion={recommendedFeed.algorithmVersion}
      />
    </div>
  );
}
