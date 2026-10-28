import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/public/catalog", () => ({
  getPublishedVideos: async () => [],
  getPopularVideos: async () => [],
  getPublicCategories: async () => [],
  getCategoryBySlug: async () => ({
    category: {
      id: "1",
      slug: "couples",
      label: "Couples",
      icon: "heart",
      description: null,
    },
    videos: [],
  }),
}));

vi.mock("@/lib/recommendations/service", () => ({
  latestRecommendations: async () => ({ videos: [], cursor: null }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

const [
  categoriesModule,
  latestModule,
  popularModule,
  categoryModule,
  aboutModule,
  contactModule,
  removalModule,
  faqModule,
  privacyModule,
  termsModule,
  dmcaModule,
  compliance2257Module,
  parentalControlsModule,
] = await Promise.all([
  import("@/app/(public)/categories/page"),
  import("@/app/(public)/latest/page"),
  import("@/app/(public)/popular/page"),
  import("@/app/(public)/category/[slug]/page"),
  import("@/app/(public)/about/page"),
  import("@/app/(public)/contact/page"),
  import("@/app/(public)/content-removal/page"),
  import("@/app/(public)/faq/page"),
  import("@/app/(public)/privacy/page"),
  import("@/app/(public)/terms/page"),
  import("@/app/(public)/dmca/page"),
  import("@/app/(public)/2257/page"),
  import("@/app/(public)/parental-controls/page"),
]);

async function renderPage(page: () => any) {
  return renderToStaticMarkup(await page());
}

describe("public video listing copy", () => {
  it("uses the requested heading, eyebrow, and description on /latest", async () => {
    const html = await renderPage(latestModule.default as any);
    expect(html).toMatch(/<h1[^>]*>Latest Videos<\/h1>/);
    expect(html).toContain(">Newest first</p>");
    expect(html).toContain("Eligible published videos, newest first.");
    expect(html).toContain("This feed is not personalized.");
    expect(html).not.toContain("Fresh uploads first");
  });

  it("describes recorded views rather than inventing ratings on /popular", async () => {
    const html = await renderPage(popularModule.default as any);
    expect(html).toMatch(/<h1[^>]*>Popular Videos<\/h1>/);
    expect(html).toContain(">Most Viewed</p>");
    expect(html).toContain(
      "Published videos ordered by recorded watch-page views.",
    );
    expect(html).not.toContain("Top Rated Videos");
    expect(html).not.toContain("Highest-rated");
  });

  it.each([
    ["/categories", () => (categoriesModule.default as any)()],
    ["/latest", () => (latestModule.default as any)()],
    ["/popular", () => (popularModule.default as any)()],
    [
      "/category/couples",
      () =>
        (categoryModule.default as any)({
          params: Promise.resolve({ slug: "couples" }),
        }),
    ],
    ["/about", () => (aboutModule.default as any)()],
    ["/contact", () => (contactModule.default as any)()],
    ["/content-removal", () => (removalModule.default as any)()],
    ["/faq", () => (faqModule.default as any)()],
    ["/privacy", () => (privacyModule.default as any)()],
    ["/terms", () => (termsModule.default as any)()],
    ["/dmca", () => (dmcaModule.default as any)()],
    ["/2257", () => (compliance2257Module.default as any)()],
    ["/parental-controls", () => (parentalControlsModule.default as any)()],
  ])(
    "aligns tag, title, and description consistently on %s",
    async (_path, page) => {
      const html = await renderPage(page);
      expect(html).toContain(
        "text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent",
      );
      expect(html).toContain(
        '<div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1"><h1 class="text-[22px] font-semibold tracking-tight">',
      );
      expect(html).toMatch(/<p class="mt-1\.5 max-w-\[\d+px\] text-\[12\.5px\] leading-relaxed text-ink-3">/);
    },
  );

  it("explicitly states on Terms, Privacy, About, FAQ, DMCA, and 2257 that erobabe does not own uploaded videos", async () => {
    for (const mod of [
      termsModule,
      privacyModule,
      aboutModule,
      faqModule,
      dmcaModule,
      compliance2257Module,
    ]) {
      const html = await renderPage(mod.default as any);
      expect(html).toMatch(/does not own/i);
    }
  });
});
