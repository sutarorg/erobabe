import {
  clampWords,
  CAROUSEL_DESCRIPTION_FALLBACK,
  CAROUSEL_DESCRIPTION_MAX_WORDS,
  CAROUSEL_TITLE_MAX_WORDS,
} from "@/lib/metadata/carousel-copy";
import type { HeroSlide } from "@/src/data/content";
import type { PublicVideo } from "./catalog";

export type CarouselVideo = PublicVideo & { carousel_position: number };

/**
 * Maps one carousel video onto the homepage hero card.
 *
 * The card is deliberately terse: the admin never writes this text. Assigning
 * the slot stores an AI headline (max 5 words) and teaser (max 10 words), and
 * the same budget is re-applied here so a video that entered the carousel before
 * the AI copy existed still prints short, readable text instead of a full SEO
 * listing title.
 */
export function heroSlideFromCarouselVideo(
  video: CarouselVideo,
  fallbackImage: string,
): HeroSlide {
  const headline =
    clampWords(video.carousel_title || video.title, CAROUSEL_TITLE_MAX_WORDS) ||
    clampWords(video.title, CAROUSEL_TITLE_MAX_WORDS);
  const sub =
    clampWords(
      video.carousel_description || video.description || CAROUSEL_DESCRIPTION_FALLBACK,
      CAROUSEL_DESCRIPTION_MAX_WORDS,
    ) || CAROUSEL_DESCRIPTION_FALLBACK;

  return {
    id: video.slug,
    eyebrow: video.category_label || "Featured",
    headline,
    sub,
    image: video.thumbnail_url || fallbackImage,
    alt: headline || video.title,
    href: `/video/${video.slug}`,
  };
}

export function heroSlidesFromCarousel(
  videos: CarouselVideo[],
  fallbackImage: string,
): HeroSlide[] {
  return videos.map((video) => heroSlideFromCarouselVideo(video, fallbackImage));
}
