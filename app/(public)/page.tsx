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
  getPopularVideos,
  getPublicCategories,
  getPublishedVideos,
  searchPublishedVideos,
} from "@/lib/public/catalog";
import { SHELF_VIDEO_LIMIT } from "@/lib/public/shelf";
import { LOGO_URL } from "@/src/data/content";
import type { Metadata } from "next";

export const revalidate = 30;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const query = q?.trim().slice(0, 160) || "";
  if (query) {
    return publicPageMetadata({
      title: "Search",
      description: "Search results on erobabe. Adults 18+ only.",
      robots: { index: false, follow: true },
      alternates: { canonical: SITE_URL },
    });
  }
  return publicPageMetadata({
    title: "erobabe — Adult Videos for 18+",
    description:
      "Watch adult videos on erobabe. Browse categories, latest uploads, and popular scenes. 18+ only.",
    alternates: { canonical: SITE_URL },
  });
}

/**
 * Preserve ranked order, then top up from the public catalog when a feed is
 * sparse. Duplicates are dropped, so a shelf never repeats a card.
 *
 * The target is a full wide shelf (`SHELF_VIDEO_LIMIT`); a phone renders the
 * first ten of those cards and a desktop panel up to four whole rows.
 */
function fillShelf<T extends { slug: string }>(
  primary: T[],
  fallback: T[],
  limit = SHELF_VIDEO_LIMIT,
): T[] {
  return uniqueVideos([primary, fallback]).slice(0, limit);
}

/** Deduplicate by slug, keeping the order each source appears in. */
function uniqueVideos<T extends { slug: string }>(sources: T[][]): T[] {
  const results: T[] = [];
  const seen = new Set<string>();
  for (const video of sources.flat()) {
    if (seen.has(video.slug)) continue;
    seen.add(video.slug);
    results.push(video);
  }
  return results;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [videos, popular, categories, carousel] = await Promise.all([
    getPublishedVideos(),
    // Second catalog source: when the newest recordings are already taken by
    // the hero and Latest, the most-viewed ones still fill a sparse shelf.
    getPopularVideos(),
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
          <div className="mt-6 grid grid-cols-1 gap-4 @md:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4">
            {mappedVideos.map((video) => (
              <PublicVideoCard key={video.slug} video={video} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const [featuredFeed, recommendedFeed] = await Promise.all([
    getRecommendationFeed({ surface: "featured", limit: SHELF_VIDEO_LIMIT }),
    getRecommendationFeed({ surface: "recommended", limit: SHELF_VIDEO_LIMIT }),
  ]);
  const carouselSlugs = new Set(carousel.map((video) => video.slug));
  const latestSlugs = new Set(latestVideos.map((video) => video.slug));
  // Newest first, then most viewed: one public catalog pool to top up from.
  const catalogPool = uniqueVideos([mappedVideos, popular]);
  const eligibleCatalog = catalogPool.filter(
    (video) => !carouselSlugs.has(video.slug) && !latestSlugs.has(video.slug),
  );
  const featuredSeed = featuredFeed.videos.filter(
    (video) => !carouselSlugs.has(video.slug) && !latestSlugs.has(video.slug),
  );
  // Last resort: the catalog is so small that Latest owns everything, and a
  // shelf with a card beats an empty shelf. Duplicates within one shelf are
  // still dropped.
  const featuredVideos = fillShelf(featuredSeed, [...eligibleCatalog, ...catalogPool]);
  const featuredSlugs = new Set(featuredVideos.map((video) => video.slug));
  const rankedRecommended = recommendedFeed.videos.filter((video) =>
    !carouselSlugs.has(video.slug) && !latestSlugs.has(video.slug) && !featuredSlugs.has(video.slug),
  );
  const recommendedVideos = fillShelf(rankedRecommended, [
    ...eligibleCatalog.filter((video) => !featuredSlugs.has(video.slug)),
    ...catalogPool,
  ]);

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

      <RecommendationShelf
        title="Recommended for you"
        videos={recommendedVideos}
        surface="recommended"
        correlationId={recommendedFeed.correlationId}
        algorithmVersion={recommendedFeed.algorithmVersion}
        trackEvents={rankedRecommended.length > 0}
      />
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
    </div>
  );
}
