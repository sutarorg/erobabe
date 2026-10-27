import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, HEAD } from "@/app/api/videos/stream/route";

/**
 * `/api/videos/stream` is the only path through which damplips bytes reach a
 * browser. These tests pin its security properties: an allow-listed host only,
 * no credentials, https only, no redirects off the media host, and a real range
 * request forwarded so seeking works.
 */

const MEDIA = "https://video.damplips.com/videos/67284.mp4";
const PROXY = `https://erobabe.test/api/videos/stream?src=${encodeURIComponent(MEDIA)}`;

let fetchMock: ReturnType<typeof vi.fn>;

function mediaResponse(init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 206,
    headers: {
      "content-type": "video/mp4",
      "content-range": "bytes 0-3/1000",
      "content-length": "4",
      "accept-ranges": "bytes",
      ...(init.headers || {}),
    },
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => mediaResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/videos/stream", () => {
  it("streams a damplips file with the referer the media host expects", async () => {
    const request = new NextRequest(PROXY, { headers: { range: "bytes=0-3" } });
    const response = await GET(request);

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-range")).toBe("bytes 0-3/1000");
    expect(response.headers.get("accept-ranges")).toBe("bytes");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(MEDIA);
    const headers = init.headers as Record<string, string>;
    expect(headers.referer).toBe("https://www.damplips.com/");
    expect(headers.range).toBe("bytes=0-3");
    expect(init.redirect).toBe("manual");
  });

  it("refuses a request without a src", async () => {
    const response = await GET(new NextRequest("https://erobabe.test/api/videos/stream"));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses any host that is not damplips", async () => {
    for (const src of [
      "https://example.com/video.mp4",
      "https://video.damplips.com.evil.example/video.mp4",
      "https://notdamplips.com/a.mp4",
    ]) {
      const response = await GET(
        new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(src)}`),
      );
      expect(response.status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses plain http, credentials and malformed URLs", async () => {
    for (const src of [
      "http://video.damplips.com/video.mp4",
      "https://user:pass@video.damplips.com/video.mp4",
      "not a url",
    ]) {
      const response = await GET(
        new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(src)}`),
      );
      expect(response.status).toBe(400);
    }
  });

  it("follows a redirect that stays on damplips", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://cdn.damplips.com/v/67284.mp4" } }),
    );
    fetchMock.mockResolvedValueOnce(mediaResponse());
    const response = await GET(new NextRequest(PROXY));
    expect(response.status).toBe(206);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://cdn.damplips.com/v/67284.mp4");
  });

  it("refuses a redirect that leaves damplips", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://example.com/video.mp4" } }),
    );
    const response = await GET(new NextRequest(PROXY));
    expect(response.status).toBe(502);
  });

  it("gives up after three redirects", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: MEDIA } }));
    const response = await GET(new NextRequest(PROXY));
    expect(response.status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("reports an unreachable or failing media host as a bad gateway", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect((await GET(new NextRequest(PROXY))).status).toBe(502);

    fetchMock.mockResolvedValueOnce(new Response("gone", { status: 404 }));
    expect((await GET(new NextRequest(PROXY))).status).toBe(502);
  });

  it("answers HEAD without a body", async () => {
    const response = await HEAD(new NextRequest(PROXY, { method: "HEAD" }));
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("");
  });
});
