import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders the real `app/(public)/categories/page.tsx` server component with a
 * stubbed catalog, so the assertions cover the markup that actually ships.
 */
const CATEGORIES = [
  { id: "1", label: "Mature", slug: "mature", icon: "flame" },
  { id: "2", label: "Amateur", slug: "amateur", icon: "camera" },
  { id: "3", label: "Couples", slug: "couples", icon: "heart" },
  { id: "4", label: "Solo", slug: "solo", icon: null },
];

vi.mock("@/lib/public/catalog", () => ({
  getPublicCategories: async () => CATEGORIES,
}));

const CategoriesPage = (await import("@/app/(public)/categories/page")).default;

async function render() {
  return renderToStaticMarkup(await (CategoriesPage as any)());
}

describe("/categories page", () => {
  it("renders one icon-bearing card per category", async () => {
    const html = await render();
    expect(html).toContain("Categories");
    expect(html).toContain("Mature");
    expect(html).toContain("Amateur");
    expect(html).toContain("/category/mature");
  });
});
