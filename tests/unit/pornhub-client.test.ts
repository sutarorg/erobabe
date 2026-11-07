// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  PornhubBlockedError,
  createPornhubFetcher,
  pornhubHostAllowed,
} from "@/lib/pornhub/client";
import {
  PORNHUB_CATEGORY_SOURCES,
  categorySource,
  configuredCategorySlugs,
} from "@/lib/pornhub/categories";

/**
 * The importer is an HTTP client pointed at a public website, so its network
 * layer has exactly two jobs: stay on pornhub.com, and tell a blocked request
 * apart from an empty one.
 */

describe("pornhub host allowlist", () => {
  it("accepts pornhub and its subdomains only", () => {
    expect(pornhubHostAllowed("https://www.pornhub.com/video/search?search=amateur")).toBe(true);
    expect(pornhubHostAllowed("https://pornhub.com/embed/abc12345")).toBe(true);
    expect(pornhubHostAllowed("https://ev.phncdn.com/v/1.mp4")).toBe(false);
    expect(pornhubHostAllowed("https://pornhub.evil.example/embed/abc12345")).toBe(false);
    expect(pornhubHostAllowed("http://127.0.0.1:8080/")).toBe(false);
    expect(pornhubHostAllowed("file:///etc/passwd")).toBe(false);
  });
});

describe("createPornhubFetcher", () => {
  const ok = (body = "<html>ok</html>", url = "https://www.pornhub.com/video/search?search=x") =>
    ({
      ok: true,
      status: 200,
      url,
      text: async () => body,
    }) as unknown as Response;

  it("reads a search page with a browser-shaped request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const fetchPage = createPornhubFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const page = await fetchPage("https://www.pornhub.com/video/search?search=amateur");
    expect(page.html).toContain("ok");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://www.pornhub.com/video/search?search=amateur");
    expect(init.headers["user-agent"]).toMatch(/Mozilla\/5\.0/);
    expect(init.headers.referer).toBe("https://www.pornhub.com/");
  });

  it("refuses to fetch anything that is not Pornhub", async () => {
    const fetchImpl = vi.fn();
    const fetchPage = createPornhubFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(fetchPage("https://evil.example/video/search")).rejects.toThrow(
      /non-Pornhub host/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a redirect that leaves Pornhub", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok("", "https://evil.example/"));
    const fetchPage = createPornhubFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      fetchPage("https://www.pornhub.com/video/search?search=amateur"),
    ).rejects.toThrow(/redirected off-site/);
  });

  it("reports a block page as blocked instead of retrying it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      url: "https://www.pornhub.com/video/search?search=amateur",
      text: async () => "forbidden",
    } as unknown as Response);

    const fetchPage = createPornhubFetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 3,
      sleep: async () => {},
    });

    await expect(
      fetchPage("https://www.pornhub.com/video/search?search=amateur"),
    ).rejects.toBeInstanceOf(PornhubBlockedError);
    // A block is permanent for this egress address: one request, no retries.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        url: "https://www.pornhub.com/video/search?search=amateur",
        text: async () => "",
      } as unknown as Response)
      .mockResolvedValue(ok());

    const fetchPage = createPornhubFetcher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 1,
      sleep: async () => {},
    });

    const page = await fetchPage("https://www.pornhub.com/video/search?search=amateur");
    expect(page.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("category sources", () => {
  it("searches each fixed category by its own name", () => {
    expect(categorySource("amateur")?.searches[0]).toBe("amateur");
    expect(categorySource("milf")?.searches[0]).toBe("milf");
    expect(categorySource("big-ass")?.searches[0]).toBe("big ass");
    // The only age-related phrase is Pornhub's own "18 Year Old" taxonomy.
    expect(categorySource("teen-18plus")?.searches[0]).toBe("18 year old");
    expect(categorySource("not-a-category")).toBeNull();
  });

  it("covers exactly the twelve fixed categories", () => {
    expect(configuredCategorySlugs()).toEqual([
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
    ]);
    expect(PORNHUB_CATEGORY_SOURCES.every((entry) => entry.searches.length > 0)).toBe(true);
  });
});
