import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/public/catalog", () => ({
  getPublishedVideos: async () => [],
  getPopularVideos: async () => [],
}));

const [latestModule, popularModule] = await Promise.all([
  import("@/app/(public)/latest/page"),
  import("@/app/(public)/popular/page"),
]);

async function renderPage(page: () => Promise<any>) {
  return renderToStaticMarkup(await page());
}

describe("public video listing copy", () => {
  it("uses the requested heading, eyebrow, and description on /latest", async () => {
    const html = await renderPage(latestModule.default as any);
    expect(html).toMatch(/<h1[^>]*>Latest Videos<\/h1>/);
    expect(html).toContain(">Fresh This Week</p>");
    expect(html).toContain("New scenes land every day, here is everything uploaded most recently.");
    expect(html).not.toContain("Fresh uploads first");
  });

  it("uses the requested community-favorites copy on /popular", async () => {
    const html = await renderPage(popularModule.default as any);
    expect(html).toMatch(/<h1[^>]*>Top Rated Videos<\/h1>/);
    expect(html).toContain(">Community Favorites</p>");
    expect(html).toContain("Highest-rated picks loved by our community.");
    expect(html).not.toContain("Popular Videos");
    expect(html).not.toContain("Most viewed");
  });
});
