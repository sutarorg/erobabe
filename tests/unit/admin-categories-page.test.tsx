import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders the real /admin/categories server component so the assertions cover
 * the columns it selects and the props it hands to CategoryManager (the client
 * component is exercised separately in category-manager.test.tsx).
 */

type Row = Record<string, any>;

const state: {
  rows: Row[];
  selects: string[];
  /** Simulates a database that has not run migration 09 yet. */
  missingImageColumn: boolean;
} = { rows: [], selects: [], missingImageColumn: false };

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: (columns: string) => {
        state.selects.push(columns);
        const fails = state.missingImageColumn && columns.includes("image_url");
        return {
          order: async () => ({
            data: fails ? null : state.rows,
            error: fails ? { message: 'column categories.image_url does not exist' } : null,
          }),
        };
      },
    }),
  }),
}));

const CategoriesAdmin = (await import("@/app/admin/categories/page")).default;

async function render() {
  return renderToStaticMarkup(await (CategoriesAdmin as any)());
}

beforeEach(() => {
  state.selects = [];
  state.missingImageColumn = false;
  state.rows = [
    {
      id: "1",
      label: "Boudoir",
      slug: "boudoir",
      icon: "sparkles",
      description: null,
      image_url: "https://cdn.example.com/video-thumbnails/categories/boudoir.jpg",
      video_count: 4,
    },
    { id: "2", label: "Amateur", slug: "amateur", icon: "camera", description: "Homemade.", image_url: null, video_count: 0 },
  ];
});

describe("/admin/categories page", () => {
  it("selects the thumbnail column so the manager can show stored images", async () => {
    const html = await render();

    expect(state.selects).toHaveLength(1);
    expect(state.selects[0]).toContain("image_url");
    expect(state.selects[0]).toContain("video_count");
    expect(html).toContain("https://cdn.example.com/video-thumbnails/categories/boudoir.jpg");
    expect(html).toContain("Thumbnail: set");
    expect(html).toContain("Thumbnail: —");
  });

  it("coerces rows into the Category shape the manager expects", async () => {
    state.rows = [
      { id: 7, label: "Solo", slug: "solo", icon: null, description: null, image_url: undefined, video_count: null },
    ];
    const html = await render();

    expect(html).toContain("Solo");
    expect(html).toContain("/solo");
    expect(html).toContain("0 videos");
  });

  it("falls back to the pre-migration column list when image_url is missing", async () => {
    state.missingImageColumn = true;
    const html = await render();

    expect(state.selects).toHaveLength(2);
    expect(state.selects[0]).toContain("image_url");
    expect(state.selects[1]).not.toContain("image_url");
    // The page still renders the taxonomy instead of erroring out.
    expect(html).toContain("Boudoir");
    expect(html).toContain("Amateur");
    expect(html).toContain("Thumbnail: —");
  });

  it("renders an empty state when the category table has no rows", async () => {
    state.rows = [];
    const html = await render();

    expect(html).toContain("No categories yet");
  });
});
