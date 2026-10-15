import { it, expect, vi } from "vitest";
let rows: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  tryCreateServiceClient: () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      range: async (start: number, end: number) => ({ data: rows.slice(start, end + 1) }),
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
      provider: "direct_url",
      playable_url: "https://cdn.example.com/video.mp4",
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
  expect(xml).toContain("<video:content_loc>https://cdn.example.com/video.mp4</video:content_loc>");
});

it("paginates beyond Supabase's default row cap and reflects deletions on the next request", async () => {
  rows = Array.from({ length: 1001 }, (_, index) => ({
    slug: `video-${index}`, title: `Listing ${index}`, thumbnail_url: "https://example.com/thumb.jpg",
    provider: "direct_url", playable_url: "https://example.com/media.mp4",
  }));
  let xml = await (await GET()).text();
  expect(xml.match(/<video:video>/g)).toHaveLength(1001);
  expect(xml).toContain("/video/video-1000");
  rows = [];
  xml = await (await GET()).text();
  expect(xml).not.toContain("/video/video-1000");
});
it("omits entries without a crawlable player or thumbnail", async () => {
  rows = [{ slug: "missing-player", title: "Unavailable", thumbnail_url: "https://example.com/thumb.jpg" }];
  expect(await (await GET()).text()).not.toContain("<video:video>");
});
