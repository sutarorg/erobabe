import { describe, expect, it } from "vitest";
import { isSearchCrawler } from "@/lib/seo/crawlers";
import { iso8601Duration } from "@/lib/seo/duration";
import { breadcrumbJsonLd, collectionPageJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";
import robots from "@/app/robots";

describe("search crawler detection", () => {
  it("recognizes Googlebot and inspection tools", () => {
    expect(isSearchCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isSearchCrawler("Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isSearchCrawler("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe(true);
  });

  it("does not treat ordinary browsers as crawlers", () => {
    expect(isSearchCrawler("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36")).toBe(false);
    expect(isSearchCrawler("")).toBe(false);
    expect(isSearchCrawler(null)).toBe(false);
  });
});

describe("ISO 8601 video duration", () => {
  it("emits hour, minute, and second components", () => {
    expect(iso8601Duration(3723)).toBe("PT1H2M3S");
    expect(iso8601Duration(90)).toBe("PT1M30S");
    expect(iso8601Duration(12)).toBe("PT12S");
  });

  it("skips empty or invalid values", () => {
    expect(iso8601Duration(0)).toBeUndefined();
    expect(iso8601Duration(-4)).toBeUndefined();
  });
});

describe("JSON-LD builders", () => {
  it("describes the site and a crawlable search action", () => {
    const data = websiteJsonLd("https://erobabe.com");
    expect(data["@type"]).toBe("WebSite");
    expect(data.url).toBe("https://erobabe.com");
    expect(data.potentialAction.target.urlTemplate).toBe("https://erobabe.com/?q={search_term_string}");
  });

  it("lists breadcrumb URLs in order", () => {
    const data = breadcrumbJsonLd(
      [
        { name: "Home", path: "/" },
        { name: "Hardcore", path: "/category/hardcore" },
      ],
      "https://erobabe.com",
    );
    expect(data.itemListElement[0].item).toBe("https://erobabe.com");
    expect(data.itemListElement[1].item).toBe("https://erobabe.com/category/hardcore");
    expect(data.itemListElement[1].position).toBe(2);
  });

  it("marks collection pages as not family-friendly", () => {
    const data = collectionPageJsonLd({
      name: "Hardcore Videos",
      description: "Adult scenes",
      path: "/category/hardcore",
      siteUrl: "https://erobabe.com",
    });
    expect(data["@type"]).toBe("CollectionPage");
    expect(data.isFamilyFriendly).toBe(false);
    expect(data.url).toBe("https://erobabe.com/category/hardcore");
  });
});

describe("robots.txt", () => {
  it("blocks staff and checkout while leaving public URLs crawlable", () => {
    const doc = robots();
    const star = Array.isArray(doc.rules) ? doc.rules[0] : doc.rules;
    expect(star.allow).toBe("/");
    expect(star.disallow).toEqual(expect.arrayContaining(["/admin", "/auth", "/api/"]));
    // /checkout is listed in sitemap.xml, so it must not be blocked here.
    expect(star.disallow).not.toContain("/checkout");
    expect(doc.sitemap).toEqual(
      expect.arrayContaining(["https://erobabe.com/sitemap.xml", "https://erobabe.com/video-sitemap.xml"]),
    );
  });
});

describe("the advertising page is a real landing page", () => {
  it("is listed in sitemap.xml", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();
    const checkout = entries.find((entry) => entry.url.endsWith("/checkout"));
    expect(checkout).toBeDefined();
    expect(checkout?.changeFrequency).toBe("weekly");
  });

  it("carries the advertising copy and is indexable", async () => {
    const { metadata } = await import("@/app/checkout/page");
    expect(metadata.title).toEqual({ absolute: "Advertise on EroBabe" });
    expect(metadata.description).toBe(
      "Advertise on EroBabe with premium image banner placements on a fast-loading HD porn site. Reach a high-intent adult audience and get your banner seen. Advertise on EroBabe today!",
    );
    expect(metadata.keywords).toEqual(
      expect.arrayContaining(["adult banner advertising", "banner ad placements", "CPM rates"]),
    );
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe("https://erobabe.com/checkout");
  });
});
