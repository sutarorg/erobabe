import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const MEDIA = "https://video.damplips.com/video7/686/01.mp4";
const BASE = "https://erobabe.test";
const PROXY = `${BASE}/api/videos/stream-edge?src=${encodeURIComponent(MEDIA)}`;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

async function route() {
  return import("@/app/api/videos/stream-edge/route");
}

function mediaResponse() {
  return new Response("abcd", {
    status: 206,
    headers: {
      "content-type": "video/mp4",
      "content-range": "bytes 0-3/118811167",
      "content-length": "4",
      "accept-ranges": "bytes",
      etag: '"abc"',
    },
  });
}

describe("GET /api/videos/stream-edge", () => {
  it("streams the file with the range the element asked for", async () => {
    fetchMock.mockResolvedValueOnce(mediaResponse());
    const { GET } = await route();

    const response = await GET(new NextRequest(PROXY, { headers: { range: "bytes=0-3" } }));

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-range")).toBe("bytes 0-3/118811167");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("abcd");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL | string, RequestInit];
    expect(String(url)).toBe(MEDIA);
    const headers = init.headers as Record<string, string>;
    expect(headers.range).toBe("bytes=0-3");
  });

  it("serves only damplips hosts", async () => {
    const { GET } = await route();
    const response = await GET(
      new NextRequest(`${BASE}/api/videos/stream-edge?src=${encodeURIComponent("https://example.com/a.mp4")}`),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a non-https destination", async () => {
    const { GET } = await route();
    const response = await GET(
      new NextRequest(`${BASE}/api/videos/stream-edge?src=${encodeURIComponent("http://video.damplips.com/a.mp4")}`),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not hand a block page to the element as if it were the video", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html><title>Just a moment...</title></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" },
      }),
    );
    const { GET } = await route();

    const response = await GET(new NextRequest(PROXY));

    expect(response.status).toBe(502);
    expect(response.headers.get("x-media-block")).toBe("challenge");
  });

  it("reports a refused status instead of streaming an error body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    const { GET } = await route();

    const response = await GET(new NextRequest(PROXY));

    expect(response.status).toBe(502);
    expect(response.headers.get("x-media-block")).toBe("host-refused");
  });

  it("answers a probe with what the host said, without downloading the film", async () => {
    fetchMock.mockResolvedValueOnce(mediaResponse());
    const { GET } = await route();

    const response = await GET(new NextRequest(`${PROXY}&probe=1`));
    const body = (await response.json()) as {
      ok: boolean;
      status: number;
      contentType: string;
      contentRange: string;
    };

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(true);
    expect(body.status).toBe(206);
    expect(body.contentType).toBe("video/mp4");
    expect(body.contentRange).toBe("bytes 0-3/118811167");
  });

  it("can prove it streams by reading a bounded number of bytes", async () => {
    // Verification without downloading a film: read 1 MB through the route.
    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(1024), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-1023/118811167",
        },
      }),
    );
    const { GET } = await route();

    const response = await GET(new NextRequest(`${PROXY}&probe=1&len=1024`));
    const body = (await response.json()) as { status: number; streamed: number };

    expect(body.status).toBe(206);
    expect(body.streamed).toBe(1024);
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL | string, RequestInit];
    expect((init.headers as Record<string, string>).range).toBe("bytes=0-1023");
  });

  it("sends a HEAD upstream request without a body", async () => {
    fetchMock.mockResolvedValueOnce(mediaResponse());
    const { HEAD } = await route();

    const response = await HEAD(new NextRequest(PROXY, { method: "HEAD" }));

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("");
  });

  it("passes a conditional request through and keeps a 304 cheap", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { etag: '"abc"' } }),
    );
    const { GET } = await route();

    const response = await GET(new NextRequest(PROXY, { headers: { "if-none-match": '"abc"' } }));

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"abc"');
  });
});
