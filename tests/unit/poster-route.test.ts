// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/videos/poster/route";
import { posterSources, posterProxyTarget, proxiedPosterUrl } from "@/lib/video/poster";

/**
 * Thumbnails were invisible because the browser was asked to fetch them from an
 * adult CDN: ad blockers drop those requests and some paths hotlink-protect a
 * foreign referer. The card now asks this origin instead, so the proxy has to be
 * a *narrow* pipe — allowlisted hosts, image content only, bounded size — and the
 * card has to fall back cleanly when it misses.
 */

function request(src: string | null): NextRequest {
  const url = new URL("https://erobabe.test/api/videos/poster");
  if (src != null) url.searchParams.set("src", src);
  return new NextRequest(url);
}

function imageResponse(body = "binary", contentType = "image/jpeg", url = "https://ei.phncdn.com/videos/x.jpg") {
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-type": contentType, "content-length": String(body.length) }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("poster URLs", () => {
  it("proxies a Pornhub CDN poster through this origin", () => {
    const source = "https://ei.phncdn.com/videos/202401/01/123/original.jpg";
    expect(proxiedPosterUrl(source)).toBe(
      `/api/videos/poster?src=${encodeURIComponent(source)}`,
    );
    expect(posterSources(source)).toEqual([
      `/api/videos/poster?src=${encodeURIComponent(source)}`,
      source,
    ]);
  });

  it("leaves other hosts, pages and non-https values alone", () => {
    expect(proxiedPosterUrl("https://cdn.example.com/a.jpg")).toBeNull();
    expect(proxiedPosterUrl("https://www.pornhub.com/view_video.php?viewkey=abc12345")).toBeNull();
    expect(proxiedPosterUrl("http://ei.phncdn.com/videos/a.jpg")).toBeNull();
    expect(proxiedPosterUrl("javascript:alert(1)")).toBeNull();
    expect(proxiedPosterUrl("data:image/gif;base64,R0lGOD")).toBeNull();
    expect(proxiedPosterUrl(null)).toBeNull();
    // A foreign image is still rendered directly; it is simply not proxied.
    expect(posterSources("https://cdn.example.com/a.jpg")).toEqual(["https://cdn.example.com/a.jpg"]);
    expect(posterSources(null)).toEqual([]);
  });

  it("accepts legacy damplips posters too", () => {
    expect(posterProxyTarget("https://video.damplips.com/pics/thumb.jpg")?.hostname).toBe(
      "video.damplips.com",
    );
  });
});

describe("GET /api/videos/poster", () => {
  it("serves the image with a year-long cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse("jpeg-bytes"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("https://ei.phncdn.com/videos/x.jpg"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    // The upstream request carries the referer the CDN expects.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ei.phncdn.com/videos/x.jpg");
    expect(init.headers.referer).toBe("https://www.pornhub.com/");
    expect(init.headers["user-agent"]).toMatch(/Mozilla\/5\.0/);
  });

  it("refuses a foreign host, a page URL and a missing source", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const src of [
      "https://evil.example/x.jpg",
      "https://www.pornhub.com/view_video.php?viewkey=abc12345",
      "http://ei.phncdn.com/x.jpg",
      null,
    ]) {
      const response = await GET(request(src));
      expect(response.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never echoes an HTML error page back as a thumbnail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(imageResponse("<html>blocked</html>", "text/html")),
    );
    const response = await GET(request("https://ei.phncdn.com/videos/x.jpg"));
    expect(response.status).toBe(404);
  });

  it("refuses a redirect that leaves the allowlist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(imageResponse("bytes", "image/jpeg", "https://evil.example/x.jpg")),
    );
    const response = await GET(request("https://ei.phncdn.com/videos/x.jpg"));
    expect(response.status).toBe(404);
  });

  it("refuses an oversized file", async () => {
    const huge = {
      ...imageResponse("bytes"),
      headers: new Headers({ "content-type": "image/jpeg", "content-length": String(20 * 1024 * 1024) }),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(huge));
    const response = await GET(request("https://ei.phncdn.com/videos/x.jpg"));
    expect(response.status).toBe(404);
  });

  it("answers 404 when the CDN is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const response = await GET(request("https://ei.phncdn.com/videos/x.jpg"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
  });
});
