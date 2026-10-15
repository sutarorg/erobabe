import { describe, expect, it } from "vitest";
import {
  heroSlideFromCarouselVideo,
  heroSlidesFromCarousel,
  type CarouselVideo,
} from "@/lib/public/hero-slides";

/**
 * The homepage carousel card is a thumbnail with two short lines. The copy is
 * generated per video when the admin assigns a carousel slot (max 5 words title,
 * max 10 words description) — and this mapping is the last line of defence, so a
 * video that entered the carousel before that copy existed still prints short
 * text instead of a full SEO listing title.
 */

const FALLBACK_IMAGE = "https://cdn.example.com/logo.png";

function carouselVideo(overrides: Partial<CarouselVideo> = {}): CarouselVideo {
  return {
    id: "vid-1",
    slug: "velvet-nights",
    title: "Velvet Nights",
    description: null,
    thumbnail_url: "https://cdn.example.com/thumb.jpg",
    duration_seconds: 512,
    view_count: 12,
    published_at: new Date().toISOString(),
    quality: "4K",
    category_label: "Boudoir",
    category_slug: "boudoir",
    carousel_position: 1,
    ...overrides,
  };
}

describe("heroSlideFromCarouselVideo", () => {
  it("prints the short AI carousel copy stored with the slot", () => {
    const slide = heroSlideFromCarouselVideo(
      carouselVideo({
        title: "I Catch My Stepsister-in-law Touching My Cock in the Tent",
        description:
          "A slow late-night scene with a lot of explicit detail and camera work.",
        carousel_title: "Seduced By The Neighbour",
        carousel_description: "She never expected him to knock tonight",
      }),
      FALLBACK_IMAGE,
    );

    expect(slide.headline).toBe("Seduced By The Neighbour");
    expect(slide.sub).toBe("She never expected him to knock tonight");
    expect(slide.eyebrow).toBe("Boudoir");
    expect(slide.href).toBe("/video/velvet-nights");
    expect(slide.image).toBe("https://cdn.example.com/thumb.jpg");
    expect(slide.alt).toBe("Seduced By The Neighbour");
  });

  it("caps a legacy listing at 5 words and 10 words when no AI copy exists", () => {
    const slide = heroSlideFromCarouselVideo(
      carouselVideo({
        title: "I Catch My Stepsister-in-law Touching My Cock in the Tent",
        description:
          "A slow late-night scene with a lot of explicit detail and camera work for the viewer",
      }),
      FALLBACK_IMAGE,
    );

    expect(slide.headline.split(" ").length).toBeLessThanOrEqual(5);
    expect(slide.sub.split(" ").length).toBeLessThanOrEqual(10);
  });

  it("keeps a shortlisting title untouched and never exceeds the budget", () => {
    const slide = heroSlideFromCarouselVideo(carouselVideo(), FALLBACK_IMAGE);
    expect(slide.headline).toBe("Velvet Nights");
    expect(slide.sub).toBe("Watch the full scene now.");
    expect(slide.eyebrow).toBe("Boudoir");
  });

  it("falls back to the brand artwork and a generic eyebrow", () => {
    const slide = heroSlideFromCarouselVideo(
      carouselVideo({ thumbnail_url: null, category_label: null }),
      FALLBACK_IMAGE,
    );
    expect(slide.image).toBe(FALLBACK_IMAGE);
    expect(slide.eyebrow).toBe("Featured");
  });
});

describe("heroSlidesFromCarousel", () => {
  it("maps every slot in order and keeps each slide inside the word budget", () => {
    const slides = heroSlidesFromCarousel(
      [
        carouselVideo({ slug: "a", carousel_position: 1, carousel_title: null }),
        carouselVideo({
          slug: "b",
          carousel_position: 2,
          carousel_title: "One Two Three Four Five Six",
          carousel_description: "One two three four five six seven eight nine ten eleven",
        }),
      ],
      FALLBACK_IMAGE,
    );

    expect(slides.map((slide) => slide.id)).toEqual(["a", "b"]);
    for (const slide of slides) {
      expect(slide.headline.split(" ").length).toBeLessThanOrEqual(5);
      expect(slide.sub.split(" ").length).toBeLessThanOrEqual(10);
    }
  });
});
