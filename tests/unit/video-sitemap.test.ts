import { it, expect, vi } from "vitest";
let rows: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  tryCreateServiceClient: () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: async () => ({ data: rows }),
    };
    return { from: () => q };
  },
}));
import { GET } from "@/app/video-sitemap.xml/route";
it("serializes empty and populated eligible-query results with escaped XML", async () => {
  rows = [];
  let xml = await (await GET()).text();
  expect(xml).toContain("</urlset>");
  expect(xml).not.toContain("<video:video>");
  rows = [
    {
      slug: "fixture",
      title: "A & B <scene>",
      thumbnail_url: "https://example.com/a.jpg?x=1&y=2",
      duration_seconds: 120,
      published_at: "2026-01-01T00:00:00Z",
    },
  ];
  xml = await (await GET()).text();
  expect(xml).toContain("<video:video>");
  expect(xml).toContain("A &amp; B &lt;scene&gt;");
  expect(xml).toContain("<video:duration>120</video:duration>");
  expect(xml).toContain("/video/fixture");
});
