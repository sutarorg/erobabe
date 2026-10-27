import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicVideo } from "@/lib/public/catalog";
import { getRecommendationFeed } from "@/lib/recommendations/service";

const video: PublicVideo = {
  id: "first",
  slug: "first",
  title: "First video",
  description: null,
  thumbnail_url: null,
  duration_seconds: null,
  view_count: 1234,
  published_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  quality: null,
  category_label: "Couples",
  category_slug: "couples",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error("not found");
  },
}));

vi.mock("@/lib/recommendations/service", () => ({
  latestRecommendations: async () => ({ videos: [video], cursor: null }),
  getRecommendationFeed: vi.fn(async ({ surface }: { surface: string }) => ({
    videos: surface === "featured" || surface === "recommended"
      ? [{ ...video, id: `${surface}-video`, slug: `${surface}-video`, title: `${surface} video` }]
      : [],
    personalized: false,
    correlationId: "test-correlation",
    algorithmVersion: "erobabe-rec-v1",
  })),
}));

vi.mock("@/lib/public/catalog", () => ({
  getPublishedVideos: async () => [video],
  searchPublishedVideos: async (query: string) =>
    [video].filter((v) => v.title.toLowerCase().includes(query.toLowerCase())),
  getCarouselVideos: async () => [],
  getPublicCategories: async () => [],
  getPopularVideos: async () => [video],
  getCategoryBySlug: async () => ({
    category: { id: "1", slug: "couples", label: "Couples", icon: "heart" },
    videos: [video],
  }),
}));

const [latest, popular, category, home] = await Promise.all([
  import("@/app/(public)/latest/page"),
  import("@/app/(public)/popular/page"),
  import("@/app/(public)/category/[slug]/page"),
  import("@/app/(public)/page"),
]);

describe("public listing grids and video cards", () => {
  it.each([
    ["/latest", () => latest.default()],
    ["/popular", () => popular.default()],
    [
      "/category/couples",
      () => category.default({ params: Promise.resolve({ slug: "couples" }) }),
    ],
  ])(
    "shows four columns, views with an icon, and relative publication time without category on card on %s",
    async (_path, page) => {
      const html = renderToStaticMarkup(await page());
      // One video per row on a phone, four columns only once the panel is wide.
      expect(html).toContain("grid-cols-1");
      expect(html).toContain("@2xl:grid-cols-4");
      expect(html).not.toContain("lg:grid-cols-5");
      expect(html).toContain("1,234 views");
      expect(html).toContain("2 days ago");
      expect(html).toContain("lucide-eye");
      expect(html).toContain(`dateTime="${video.published_at}"`);
      expect(html).not.toContain("<span>Couples</span>");
    },
  );

  it("renders distinct homepage recommendation and chronological sections in four-row grids", async () => {
    const html = renderToStaticMarkup(
      await home.default({ searchParams: Promise.resolve({}) }),
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const videoGrids = Array.from(doc.querySelectorAll("[data-grid-rows='4']"));
    expect(videoGrids.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Featured Videos");
    expect(html).toContain("Latest Videos");
    expect(html).toContain("Recommended for you");
    expect(videoGrids.every((grid) => !grid.className.includes("grid-cols-5"))).toBe(true);
    expect(html).not.toContain("repeat(auto-fill");
  });

  it("puts Recommended for you first and fills it from the public catalog when recommendations are empty", async () => {
    vi.mocked(getRecommendationFeed).mockResolvedValue({
      videos: [],
      cursor: null,
      personalized: false,
      correlationId: "empty-feed",
      algorithmVersion: "erobabe-rec-v1",
    });

    const html = renderToStaticMarkup(
      await home.default({ searchParams: Promise.resolve({}) }),
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const recommended = doc.querySelector('section[aria-label="Recommended for you"]');

    expect(html.indexOf("Recommended for you")).toBeLessThan(html.indexOf("Featured Videos"));
    expect(recommended?.textContent).toContain("First video");
    expect(recommended?.querySelectorAll('a[href^="/video/"]').length).toBeGreaterThan(0);
  });

  it("removes the old five-column layout from search results too", async () => {
    const html = renderToStaticMarkup(
      await home.default({ searchParams: Promise.resolve({ q: "First" }) }),
    );
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("@2xl:grid-cols-4");
    expect(html).not.toContain("grid-cols-5");
  });

  it("shows zero views, a safe fallback for missing publication dates, and omits category from card", async () => {
    const { default: PublicVideoCard } = await import(
      "@/src/components/PublicVideoCard"
    );
    const html = renderToStaticMarkup(
      <PublicVideoCard
        video={{ ...video, view_count: 0, published_at: null }}
      />,
    );
    expect(html).toContain("0 views");
    expect(html).toContain("Recently");
    expect(html).not.toContain("Invalid Date");
    expect(html).not.toContain("Couples");
  });
});
