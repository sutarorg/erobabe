import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders the real public /categories server component with a stubbed catalog,
 * so assertions cover the markup that actually ships.
 */
const CATEGORIES = [
  { id: "1", label: "Mature", slug: "mature", icon: "flame" },
  { id: "2", label: "Amateur", slug: "amateur", icon: "camera" },
  { id: "3", label: "POV", slug: "pov", icon: "eye" },
  { id: "4", label: "Lesbian", slug: "lesbian", icon: "users" },
  { id: "5", label: "Kinky", slug: "kinky", icon: "mask" },
  { id: "6", label: "Mature 18+", slug: "mature-18plus", icon: "wine" },
  { id: "7", label: "Couples", slug: "couples", icon: "heart" },
  { id: "8", label: "Boudoir", slug: "boudoir", icon: "sparkles" },
  { id: "9", label: "Romantic", slug: "romantic", icon: "heart" },
  { id: "10", label: "Solo", slug: "solo", icon: "user" },
  { id: "11", label: "Roleplay", slug: "roleplay", icon: "drama" },
  { id: "12", label: "Massage", slug: "massage", icon: "flower" },
];

vi.mock("@/lib/public/catalog", () => ({
  getPublicCategories: async () => CATEGORIES,
}));

const CategoriesPage = (await import("@/app/(public)/categories/page")).default;

async function render() {
  return renderToStaticMarkup(await (CategoriesPage as any)());
}

describe("/categories page", () => {
  it("renders 12 icon-bearing cards in a three-column grid", async () => {
    const html = await render();
    expect(html).toContain("Categories");
    expect(html).toContain("Mature");
    expect(html).toContain("Amateur");
    expect(html).toContain("/category/mature");
    expect(html).toContain("grid-cols-3");
    expect(html.split('href="/category/').length - 1).toBe(12);
  });
});
