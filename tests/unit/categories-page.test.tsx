import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders the real public /categories server component with a stubbed catalog,
 * so assertions cover the markup that actually ships.
 */
const CATEGORIES = [
  { id: "1", label: "Mature", slug: "mature", icon: "flame", video_count: 5, image_url: "https://cdn.example.com/categories/mature.jpg" },
  { id: "2", label: "Amateur", slug: "amateur", icon: "camera", video_count: 0 },
  { id: "3", label: "POV", slug: "pov", icon: "eye", video_count: 0 },
  { id: "4", label: "Lesbian", slug: "lesbian", icon: "users", video_count: 0 },
  { id: "5", label: "Kinky", slug: "kinky", icon: "mask", video_count: 0 },
  { id: "6", label: "Mature 18+", slug: "mature-18plus", icon: "wine", video_count: 0 },
  { id: "7", label: "Couples", slug: "couples", icon: "heart", video_count: 0 },
  { id: "8", label: "Boudoir", slug: "boudoir", icon: "sparkles", video_count: 0 },
  { id: "9", label: "Romantic", slug: "romantic", icon: "heart", video_count: 0 },
  { id: "10", label: "Solo", slug: "solo", icon: "user", video_count: 0 },
  { id: "11", label: "Roleplay", slug: "roleplay", icon: "drama", video_count: 0 },
  { id: "12", label: "Massage", slug: "massage", icon: "flower", video_count: 0 },
];

vi.mock("@/lib/public/catalog", () => ({
  getPublicCategories: async () => CATEGORIES,
}));

const CategoriesPage = (await import("@/app/(public)/categories/page")).default;

async function render() {
  return renderToStaticMarkup(await (CategoriesPage as any)());
}

describe("/categories page", () => {
  it("renders all 12 category cards in a four-column grid", async () => {
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>All Categories<\/h1>/);
    expect(html).toContain("Mature");
    expect(html).toContain("Amateur");
    expect(html).toContain("/category/mature");

    // 12 cards ÷ 4 columns = three even rows at full width.
    const grid = html.match(/<div class="([^"]*grid[^"]*)"/);
    expect(grid?.[1]).toContain("@lg:grid-cols-4");
    expect(grid?.[1]).toContain("auto-rows-fr");
    expect(html.split('href="/category/').length - 1).toBe(12);
  });

  it("shows the requested eyebrow, introduction, and per-category video counts", async () => {
    const html = await render();
    expect(html).toContain(">Browse</p>");
    expect(html).not.toContain(">Browser</p>");
    expect(html).toContain("Explore the library by what you love — every category is hand-curated and updated daily.");
    expect(html).toContain(">5 videos</span>");
    expect(html).toContain("Browse Mature, 5 videos");
  });

  it("renders the admin-uploaded thumbnail on the card that has one", async () => {
    const html = await render();
    // The Mature card carries an uploaded image…
    expect(html).toContain('src="https://cdn.example.com/categories/mature.jpg"');
    // …and every other card still falls back to its icon (an inline svg).
    expect(html).toContain("<svg");
    // Cards without an image render no <img> for that category.
    expect(html.split("<img").length - 1).toBe(1);
  });
});
