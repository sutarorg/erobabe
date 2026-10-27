import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import RecommendationShelf from "@/src/components/RecommendationShelf";
import {
  MOBILE_SHELF_LIMIT,
  SHELF_VIDEO_LIMIT,
  UP_NEXT_VIDEO_LIMIT,
} from "@/lib/public/shelf";
import type { PublicVideo } from "@/lib/public/catalog";

const videos: PublicVideo[] = Array.from({ length: 16 }, (_, index) => ({
  id: `video-${index}`,
  slug: `video-${index}`,
  title: `Video ${index}`,
  description: null,
  thumbnail_url: null,
  duration_seconds: null,
  view_count: 0,
  published_at: null,
  quality: null,
  category_label: null,
  category_slug: null,
}));

function stubViewport(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: mobile,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  // A phone-width container is measured below the 448px breakpoint, so every
  // shelf renders a single column no matter how wide the test viewport is.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 360);
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as any).matchMedia;
});

describe("recommendation shelf layout", () => {
  it("shows eight Up Next videos in a four-row, two-column grid", () => {
    const html = renderToStaticMarkup(
      <RecommendationShelf title="Up Next" surface="up_next" videos={videos} />,
    );
    const grid = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector('[aria-label="Up Next"] [data-grid-rows="4"]') as HTMLElement;

    expect(grid).toBeTruthy();
    expect(grid.className).not.toContain("grid-cols-1");
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(grid.children).toHaveLength(UP_NEXT_VIDEO_LIMIT);
  });

  it("fills a wide shelf with four whole rows and no fifth", async () => {
    stubViewport(false);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1200,
    });
    render(<RecommendationShelf title="Recommended for you" surface="recommended" videos={videos} />);

    expect(await screen.findAllByRole("link")).toHaveLength(SHELF_VIDEO_LIMIT);
    expect(screen.getAllByRole("link").length % 4).toBe(0);
  });

  it.each(["recommended", "featured", "most_liked"] as const)(
    "shows up to ten videos in a mobile %s shelf",
    async (surface) => {
      stubViewport(true);
      render(<RecommendationShelf title={`${surface} shelf`} surface={surface} videos={videos} />);

      const cards = await screen.findAllByRole("link");
      expect(cards).toHaveLength(MOBILE_SHELF_LIMIT);
      expect(cards[0].getAttribute("href")).toBe("/video/video-0");
      expect(cards[MOBILE_SHELF_LIMIT - 1].getAttribute("href")).toBe(
        `/video/video-${MOBILE_SHELF_LIMIT - 1}`,
      );
    },
  );

  it("keeps the decorative Up Next shelf at eight cards on a phone too", async () => {
    stubViewport(true);
    render(<RecommendationShelf title="Up Next" surface="up_next" videos={videos} />);
    expect(await screen.findAllByRole("link")).toHaveLength(UP_NEXT_VIDEO_LIMIT);
  });

  it("does not repeat a card when a shelf has fewer videos than a phone shows", async () => {
    stubViewport(true);
    render(
      <RecommendationShelf title="Sparse" surface="recommended" videos={videos.slice(0, 3)} />,
    );
    expect(await screen.findAllByRole("link")).toHaveLength(3);
  });
});
