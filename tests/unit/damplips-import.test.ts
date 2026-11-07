// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createDamplipsFetcher,
  damplipsHostAllowed,
} from "@/lib/damplips/client";
import { nextListingPage, parseListing } from "@/lib/damplips/parse";
import { searchUrl } from "@/lib/damplips/categories";

/**
 * The importer is an HTTP client pointed at a public website, so its network
 * layer has exactly two jobs: stay on damplips, and tell a blocked request apart
 * from an empty one. Pagination is the third thing that must never be guessed:
 * damplips prints `rel=next`, uses `?paged=N` on searches and `/page/N/` on
 * archives.
 */

describe("damplips host allowlist", () => {
  it("accepts damplips and its subdomains only", () => {
    expect(damplipsHostAllowed("https://www.damplips.com/c/amateur/")).toBe(true);
    expect(damplipsHostAllowed("https://video.damplips.com/video7/717/79.mp4")).toBe(true);
    expect(damplipsHostAllowed("https://damplips.evil.example/p/1/")).toBe(false);
    expect(damplipsHostAllowed("http://127.0.0.1:8080/")).toBe(false);
    expect(damplipsHostAllowed("file:///etc/passwd")).toBe(false);
  });
});

describe("createDamplipsFetcher", () => {
  const ok = (body = "<html>ok</html>", url = "https://www.damplips.com/c/amateur/") =>
    ({
      ok: true,
      status: 200,
      url,
      text: async () => body,
    }) as unknown as Response;

  it("reads a listing page with a browser-shaped request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const fetchPage = createDamplipsFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const page = await fetchPage("https://www.damplips.com/c/amateur/");
    expect(page.html).toContain("ok");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://www.damplips.com/c/amateur/");
    expect(init.headers["user-agent"]).toMatch(/Mozilla\/5\.0/);
    expect(init.headers.accept).toContain("text/html");
  });

  it("refuses to fetch anything that is not damplips", async () => {
    const fetchImpl = vi.fn();
    const fetchPage = createDamplipsFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(fetchPage("https://evil.example/p/1/")).rejects.toThrow(/non-damplips host/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a redirect that leaves damplips", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok("", "https://evil.example/"));
    const fetchPage = createDamplipsFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(fetchPage("https://www.damplips.com/c/amateur/")).rejects.toThrow(
      /redirected off-site/,
    );
  });

  it("retries a transient failure and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        url: "https://www.damplips.com/c/amateur/",
        text: async () => "",
      } as unknown as Response)
      .mockResolvedValue(ok());

    const fetchPage = createDamplipsFetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 1,
      sleep: async () => {},
    });

    const page = await fetchPage("https://www.damplips.com/c/amateur/");
    expect(page.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a hard failure instead of retrying it forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      url: "https://www.damplips.com/most-popular/",
      text: async () => "not found",
    } as unknown as Response);

    const fetchPage = createDamplipsFetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 2,
      sleep: async () => {},
    });

    await expect(fetchPage("https://www.damplips.com/most-popular/")).rejects.toThrow(/404/);
  });
});

describe("listing pagination", () => {
  const listing = (next?: string) =>
    `<html><body><a href="/p/67284/" title="A post title">x</a>${
      next ? `<a rel="next" href="${next}">Next</a>` : ""
    }</body></html>`;

  it("follows the next link the page prints", () => {
    expect(
      nextListingPage("https://www.damplips.com/most-popular/", listing("/most-popular/page/2/")),
    ).toBe("https://www.damplips.com/most-popular/page/2/");
  });

  it("pages a search the way the site's own pagination does", () => {
    expect(nextListingPage(searchUrl("amateur"), listing())).toBe(
      "https://www.damplips.com/?s=amateur&paged=2",
    );
  });

  it("pages an archive path with the theme's /page/N/ shape", () => {
    expect(nextListingPage("https://www.damplips.com/c/milf/", listing())).toBe(
      "https://www.damplips.com/c/milf/page/2/",
    );
    expect(nextListingPage("https://www.damplips.com/c/milf/page/2/", listing())).toBe(
      "https://www.damplips.com/c/milf/page/3/",
    );
  });

  it("reads the cards a listing page actually has", () => {
    const { cards } = parseListing(
      `<ul>
        <li><a href="/p/67284/" title="Morning light"><img src="https://video.damplips.com/pics/1.jpg" /></a></li>
        <li><a href="/p/67285/">A second post title</a></li>
        <li><a href="/about/">Navigation link</a></li>
      </ul>`,
      "https://www.damplips.com/c/amateur/",
    );
    expect(cards.map((card) => card.sourceId)).toEqual(["67284", "67285"]);
    expect(cards[0].thumbnailUrl).toBe("https://video.damplips.com/pics/1.jpg");
  });
});
