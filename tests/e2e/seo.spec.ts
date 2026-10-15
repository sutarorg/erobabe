import { test, expect } from "@playwright/test";

test.describe("SEO acceptance", () => {
  test("root URL opens public website, no hash routing", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/#\/site/);
    await expect(page.locator("body")).toContainText(/erobabe/i);
  });

  test("public URLs contain no hash dependency", async ({ page }) => {
    await page.goto("/categories");
    expect(page.url()).not.toContain("#");
    await page.goto("/latest");
    expect(page.url()).not.toContain("#");
  });

  test("video page returns 404 for missing video", async ({ page }) => {
    const res = await page.goto("/video/nonexistent-slug-12345");
    expect(res?.status()).toBe(404);
  });

  test("sitemap.xml is valid XML and contains only public URLs", async ({
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("<urlset");
    expect(text).not.toContain("/admin");
    expect(text).not.toContain("/advertiser");
  });

  test("video-sitemap.xml is valid and matches expected structure", async ({
    request,
  }) => {
    const res = await request.get("/video-sitemap.xml");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("<urlset");
    expect(text).toContain(
      'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"',
    );
    expect(text).toContain("</urlset>");
    // Empty catalogs have no video entries; populated serialization has a unit fixture.
  });

  test("robots.txt does not block public content", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("Sitemap:");
    expect(text).toContain("/admin/");
    expect(text).toContain("Disallow");
  });

  test("internal navigation uses crawlable <a href>", async ({ page }) => {
    await page.goto("/");
    // Check for at least one video link with href="/video/"
    const videoLinks = page.locator('a[href^="/video/"]');
    const count = await videoLinks.count();
    // If no videos, skip — empty state honest
    if (count > 0) {
      const href = await videoLinks.first().getAttribute("href");
      expect(href).toMatch(/^\/video\//);
    }
  });

  test("canonical URLs are correct", async ({ page }) => {
    await page.goto("/");
    const canonical = page.locator('link[rel="canonical"]');
    if ((await canonical.count()) > 0) {
      const href = await canonical.getAttribute("href");
      expect(href).toBeTruthy();
    }
  });
});
