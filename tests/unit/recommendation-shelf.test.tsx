import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RecommendationShelf from "@/src/components/RecommendationShelf";
import type { PublicVideo } from "@/lib/public/catalog";

const videos: PublicVideo[] = Array.from({ length: 12 }, (_, index) => ({
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
    expect(grid.children).toHaveLength(8);
  });
});
