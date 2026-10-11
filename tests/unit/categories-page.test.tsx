import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders the real `app/(public)/categories/page.tsx` server component with a
 * stubbed Supabase client, so the assertions cover the markup that actually
 * ships — including the seeded category rows from the migration.
 */
const CATEGORIES = [
  { id: "1", label: "Mature", slug: "mature", icon: "flame" },
  { id: "2", label: "Amateur", slug: "amateur", icon: "camera" },
  { id: "3", label: "Couples", slug: "couples", icon: "heart" },
  { id: "4", label: "Solo", slug: "solo", icon: null },
];

const selectedTables: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      selectedTables.push(table);
      return {
        select: () => ({
          order: async () => ({ data: table === "categories" ? CATEGORIES : [], error: null }),
        }),
      };
    },
  }),
}));

const CategoriesPage = (await import("@/app/(public)/categories/page")).default;

async function render() {
  // It is an async server component — await it, then render the element.
  return renderToStaticMarkup(await (CategoriesPage as any)());
}

describe("/categories page", () => {
  it("renders one icon-bearing card per category", async () => {
    const html = await render();

    for (const category of CATEGORIES) {
      expect(html).toContain(`href="/category/${category.slug}"`);
      expect(html).toContain(category.label);
    }

    expect(html).toContain("lucide-flame");
    expect(html).toContain("lucide-camera");
    expect(html).toContain("lucide-heart");
    // Solo has no icon stored — resolved from the slug rather than collapsing
    // onto the same fallback glyph as every other category.
    expect(html).toContain("lucide-user-round");
  });

  it("no longer shows a video count on the cards", async () => {
    const html = await render();
    expect(html).not.toMatch(/\d+\s+videos/);
  });

  it("does not query the videos table just to count", async () => {
    selectedTables.length = 0;
    await render();
    expect(selectedTables).toEqual(["categories"]);
  });
});
