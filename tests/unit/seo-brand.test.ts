import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { metadata as rootMetadata } from "@/app/layout";
import manifest from "@/app/manifest";
import { publicPageMetadata, staticPageMetadata } from "@/lib/metadata/page";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";
import {
  CATEGORY_SEO,
  STATIC_PAGE_SEO,
  categorySeo,
  videoSeo,
} from "@/lib/seo/pages";
import { SITE_URL } from "@/lib/site";

const PUBLIC_DIR = path.join(process.cwd(), "public");

/** Width and height straight out of a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(path.join(PUBLIC_DIR, file));
  expect(buffer.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("site name in search results", () => {
  it("tells Google the site is called EroBabe", () => {
    const site = websiteJsonLd("https://erobabe.com");
    expect(site["@type"]).toBe("WebSite");
    expect(site.name).toBe("EroBabe");
    // The lowercase spelling is offered as an alternative, never as the name.
    expect(site.alternateName).toContain("erobabe");
    expect(site.url).toBe("https://erobabe.com");
    expect(site.potentialAction.target.urlTemplate).toBe(
      "https://erobabe.com/?q={search_term_string}",
    );
  });

  it("never claims erobabe.com as the site name", () => {
    const site = websiteJsonLd("https://erobabe.com");
    expect(site.name).not.toContain(".com");
    expect(site.alternateName).not.toContain("erobabe.com");
  });

  it("keeps the same site name in share cards and the app manifest", () => {
    expect(rootMetadata.openGraph?.siteName).toBe("EroBabe");
    expect(rootMetadata.applicationName).toBe("EroBabe");
    const web = manifest();
    expect(web.name).toBe("EroBabe");
    expect(web.short_name).toBe("EroBabe");
  });

  it("emits the brand suffix through the layout title template", () => {
    expect(rootMetadata.title).toEqual({
      default: expect.stringContaining("EroBabe"),
      template: "%s | EroBabe",
    });
  });
});

describe("favicon and publisher logo", () => {
  it("points every icon at a file this site hosts", () => {
    const icons = rootMetadata.icons as { icon?: { url: string }[] };
    const iconList = Array.isArray(icons?.icon) ? icons.icon : [];
    expect(iconList.length).toBeGreaterThanOrEqual(3);
    for (const icon of iconList) {
      expect(icon.url.startsWith("/")).toBe(true);
      expect(icon.url).not.toContain("postimg");
      expect(icon.url).not.toContain("ibb.co");
    }
    expect(iconList.map((icon) => icon.url)).toContain("/favicon.ico");
    expect(iconList.map((icon) => icon.url)).toContain("/icons/icon-48x48.png");
    expect(rootMetadata.manifest).toBe("/manifest.webmanifest");
  });

  it("ships square icons a search crawler can fetch", () => {
    expect(existsSync(path.join(PUBLIC_DIR, "favicon.ico"))).toBe(true);
    for (const size of [48, 96, 144, 192, 512]) {
      const file = `icons/icon-${size}x${size}.png`;
      expect(pngSize(file)).toEqual({ width: size, height: size });
    }
    expect(pngSize("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(pngSize("brand/erobabe-logo.png")).toEqual({ width: 600, height: 600 });
  });

  it("advertises the logo as the publisher and default share image", () => {
    const org = organizationJsonLd("https://erobabe.com");
    expect(org.name).toBe("EroBabe");
    expect(org.logo.url).toBe("https://erobabe.com/brand/erobabe-logo.png");
    expect(org.logo.width).toBe(600);

    const meta = publicPageMetadata({ title: "Anything" });
    expect(meta.openGraph?.images).toEqual([`${SITE_URL}/brand/erobabe-logo.png`]);
    expect(meta.twitter?.images).toEqual([`${SITE_URL}/brand/erobabe-logo.png`]);
  });

  it("lists the same icons in the web app manifest", () => {
    const icons = manifest().icons ?? [];
    expect(icons.map((icon) => icon.src)).toContain("/icons/icon-512x512.png");
    for (const icon of icons) {
      expect(existsSync(path.join(PUBLIC_DIR, String(icon.src).replace(/^\//, "")))).toBe(true);
    }
  });
});

describe("page copy from the brief", () => {
  it("uses the exact home title and description", () => {
    expect(STATIC_PAGE_SEO.home.title).toBe("Free HD Porn Videos & XXX Movies");
    expect(STATIC_PAGE_SEO.home.description).toBe(
      "Explore Erobabe's growing collection of high-quality XXX movies and clips. Watch new free porn videos and trending adult content, updated regularly. 18+ only.",
    );
    expect(STATIC_PAGE_SEO.home.keywords).toContain("XXX movies");
  });

  it("covers every static page with a brand-consistent title", () => {
    const expected: Record<string, string> = {
      categories: "Browse All Porn Categories | EroBabe",
      latest: "Latest Porn Videos | EroBabe",
      popular: "Most Popular Porn Videos | EroBabe",
      terms: "Terms of Service | EroBabe",
      privacy: "Privacy Policy | EroBabe",
      dmca: "DMCA & Copyright Policy | EroBabe",
      compliance2257: "18 U.S.C. 2257 | EroBabe",
      parentalControls: "Parental Controls | EroBabe",
      contentRemoval: "Content Removal Request | EroBabe",
      about: "About EroBabe",
      contact: "Contact EroBabe",
      faq: "EroBabe FAQ",
    };
    for (const [key, title] of Object.entries(expected)) {
      expect(STATIC_PAGE_SEO[key as keyof typeof STATIC_PAGE_SEO].title).toBe(title);
    }
  });

  it("never repeats the brand inside one title", () => {
    const all = [
      ...Object.values(STATIC_PAGE_SEO),
      ...Object.values(CATEGORY_SEO),
    ];
    for (const copy of all) {
      expect(copy.title.match(/EroBabe/g)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(copy.description.length).toBeGreaterThan(60);
      expect(copy.keywords.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("describes every seeded category", () => {
    const slugs = [
      "amateur",
      "lesbian",
      "milf",
      "japanese",
      "teen-18plus",
      "hentai",
      "ebony",
      "pov",
      "big-ass",
      "threesome",
      "hardcore",
      "massage",
    ];
    for (const slug of slugs) {
      const copy = CATEGORY_SEO[slug];
      expect(copy, slug).toBeDefined();
      expect(copy.title.startsWith("Free ")).toBe(true);
      expect(copy.title.endsWith(" | EroBabe")).toBe(true);
    }
  });

  it("writes honest copy for a category added later", () => {
    const copy = categorySeo("vr", "VR");
    expect(copy.title).toBe("VR Porn Videos | EroBabe");
    expect(copy.description).toContain("VR");
    expect(copy.keywords.length).toBeGreaterThan(0);
  });

  it("gives a watch page its category's description and keywords", () => {
    const seo = videoSeo({
      title: "Shared Lover Threesome",
      categorySlug: "threesome",
      categoryLabel: "Threesome",
    });
    expect(seo.title).toBe("Shared Lover Threesome");
    expect(seo.description).toBe(CATEGORY_SEO.threesome.description);
    expect(seo.keywords).toEqual(CATEGORY_SEO.threesome.keywords);

    const orphan = videoSeo({ title: "Lonely Clip" });
    expect(orphan.description).toContain("Lonely Clip");
    expect(orphan.keywords).toContain("EroBabe");
  });
});

describe("metadata assembly", () => {
  it("emits finished titles as absolute so the template cannot double the brand", () => {
    const meta = staticPageMetadata("latest", "/latest");
    expect(meta.title).toEqual({ absolute: "Latest Porn Videos | EroBabe" });
    expect(meta.description).toBe(STATIC_PAGE_SEO.latest.description);
    expect(meta.keywords).toEqual(STATIC_PAGE_SEO.latest.keywords);
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/latest`);
    expect(meta.openGraph?.title).toBe("Latest Porn Videos | EroBabe");
    expect(meta.openGraph?.siteName).toBe("EroBabe");
  });

  it("canonicalises the home page without a trailing slash", () => {
    expect(staticPageMetadata("home").alternates?.canonical).toBe(SITE_URL);
  });

  it("keeps the site name on pages that bring their own share card", () => {
    const withThumb = publicPageMetadata({
      title: "A Scene",
      openGraph: {
        type: "video.other",
        title: "A Scene",
        url: "https://erobabe.com/video/a",
        images: ["https://cdn.example.com/a.jpg"],
      },
    });
    expect(withThumb.openGraph?.siteName).toBe("EroBabe");
    expect(withThumb.openGraph?.images).toEqual(["https://cdn.example.com/a.jpg"]);

    const noImage = publicPageMetadata({
      title: "Another Scene",
      openGraph: { type: "video.other", title: "Another Scene" },
    });
    expect(noImage.openGraph?.images).toEqual([`${SITE_URL}/brand/erobabe-logo.png`]);
  });

  it("keeps dynamic titles templated", () => {
    const meta = publicPageMetadata({ title: "A Scene Title" });
    expect(meta.title).toBe("A Scene Title");
    expect(meta.openGraph?.title).toBe("A Scene Title");
    expect(meta.twitter?.title).toBe("A Scene Title");
  });
});

describe("wiring", () => {
  it("uses the brief's copy when a category page builds its metadata", async () => {
    vi.resetModules();
    vi.doMock("@/lib/public/catalog", () => ({
      getCategoryBySlug: async (slug: string) => ({
        category: { id: "1", slug, label: "Amateur", description: "db copy", icon: null },
        videos: [{ slug: "one" }],
      }),
      getPublicCategories: async () => [],
      getPublishedVideos: async () => [],
      getPopularVideos: async () => [],
    }));
    const { generateMetadata } = await import("@/app/(public)/category/[slug]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "amateur" }) });
    expect(meta.title).toEqual({ absolute: CATEGORY_SEO.amateur.title });
    expect(meta.description).toBe(CATEGORY_SEO.amateur.description);
    expect(meta.keywords).toEqual(CATEGORY_SEO.amateur.keywords);
    expect(meta.robots).toMatchObject({ index: true, follow: true });
    vi.doUnmock("@/lib/public/catalog");
  });
});
