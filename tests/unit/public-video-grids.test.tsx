import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicVideo } from "@/lib/public/catalog";
import { getPublishedVideos, getPopularVideos } from "@/lib/public/catalog";
import { getRecommendationFeed } from "@/lib/recommendations/service";
import { SHELF_VIDEO_LIMIT } from "@/lib/public/shelf";

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
  getPublishedVideos: vi.fn(async () => [video]),
  searchPublishedVideos: vi.fn(async (query: string) =>
    [video].filter((v) => v.title.toLowerCase().includes(query.toLowerCase()))),
  getCarouselVideos: vi.fn(async () => []),
  getPublicCategories: vi.fn(async () => []),
  getPopularVideos: vi.fn(async () => [video]),
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

afterEach(() => {
  vi.mocked(getRecommendationFeed).mockClear();
  vi.mocked(getPublishedVideos).mockResolvedValue([video]);
  vi.mocked(getPopularVideos).mockResolvedValue([video]);
});

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

  it("asks for a full wide shelf and tops a sparse home page up from the whole public catalog", async () => {
    // The two newest videos are claimed by the hero row and Latest, so nothing
    // is left for Featured or Recommended except the most-viewed catalog.
    const newest = [
      { ...video, id: "newest-1", slug: "newest-1", title: "Newest one" },
      { ...video, id: "newest-2", slug: "newest-2", title: "Newest two" },
    ];
    const popular = Array.from({ length: 12 }, (_, index) => ({
      ...video,
      id: `popular-${index}`,
      slug: `popular-${index}`,
      title: `Popular ${index}`,
    }));
    vi.mocked(getPublishedVideos).mockResolvedValue(newest);
    vi.mocked(getPopularVideos).mockResolvedValue(popular);
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
    const recommended = doc.querySelector('section[aria-label="Recommended for you"]') as HTMLElement;
    const featured = doc.querySelector('section[aria-label="Featured Videos"]') as HTMLElement;

    for (const shelf of [recommended, featured]) {
      expect(shelf).toBeTruthy();
      expect(shelf.textContent).toMatch(/Popular \d/);
      // No shelf repeats a card, even when it is topped up from the catalog.
      const hrefs = Array.from(shelf.querySelectorAll('a[href^="/video/"]'))
        .map((link) => link.getAttribute("href"));
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
    // Both feeds are asked for a full wide shelf, not a partial row.
    for (const call of vi.mocked(getRecommendationFeed).mock.calls) {
      expect(call[0]).toMatchObject({ limit: SHELF_VIDEO_LIMIT });
    }
    expect(SHELF_VIDEO_LIMIT).toBe(16);
  });

  it("never pads a sparse home shelf with duplicate cards", async () => {
    vi.mocked(getPublishedVideos).mockResolvedValue([video]);
    vi.mocked(getPopularVideos).mockResolvedValue([video]);
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
    for (const label of ["Recommended for you", "Featured Videos"]) {
      const shelf = doc.querySelector(`section[aria-label="${label}"]`) as HTMLElement | null;
      expect(shelf).toBeTruthy();
      const titles = Array.from(shelf!.querySelectorAll("h3")).map((heading) => heading.textContent);
      expect(new Set(titles).size).toBe(titles.length);
      expect(titles.length).toBeLessThanOrEqual(SHELF_VIDEO_LIMIT);
    }
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
