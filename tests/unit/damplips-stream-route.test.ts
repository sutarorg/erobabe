import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, HEAD, isPrivateHost } from "@/app/api/videos/stream/route";
import { clearPageMediaCache } from "@/lib/video/page-media";

/**
 * `/api/videos/stream` is the only path through which damplips bytes reach a
 * browser. These tests pin its security properties — a damplips seed, no
 * credentials, https only, no private hosts — and its playback behaviour: range
 * requests are forwarded so seeking works, and HLS playlists are rewritten so
 * every segment comes back through this same route instead of being blocked by
 * CORS or resolved against the wrong base URL.
 */

const MEDIA = "https://video.damplips.com/videos/67284.mp4";
const PROXY = `https://erobabe.test/api/videos/stream?src=${encodeURIComponent(MEDIA)}`;
const proxied = (url: string) => `/api/videos/stream?src=${encodeURIComponent(url)}`;

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
  // Post-page resolutions are cached for half an hour; each test starts clean.
  clearPageMediaCache();
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

  it("asks the media host for bytes it can hand to a video element unchanged", async () => {
    await GET(new NextRequest(PROXY, { headers: { range: "bytes=0-3" } }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["accept-encoding"]).toBe("identity");
  });

  it("rewrites an HLS playlist so every segment is fetched through the proxy", async () => {
    const playlistUrl = "https://video.damplips.com/videos/67284/index.m3u8";
    fetchMock.mockResolvedValueOnce(
      new Response(
        [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          '#EXT-X-KEY:METHOD=AES-128,URI="/keys/67284.key"',
          "#EXT-X-STREAM-INF:BANDWIDTH=1200000",
          "720p/index.m3u8",
          "",
        ].join("\n"),
        { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } },
      ),
    );

    const response = await GET(
      new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(playlistUrl)}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    const body = await response.text();
    expect(body).toContain(`#EXT-X-KEY:METHOD=AES-128,URI="${proxied("https://video.damplips.com/keys/67284.key")}"`);
    expect(body).toContain(proxied("https://video.damplips.com/videos/67284/720p/index.m3u8"));
    // The relative path is resolved against the playlist, never against us.
    expect(body).not.toContain("\n720p/index.m3u8");
  });

  it("rewrites media segments listed as plain URIs", async () => {
    const playlistUrl = "https://video.damplips.com/videos/67284/index.m3u8";
    fetchMock.mockResolvedValueOnce(
      new Response(
        [
          "#EXTM3U",
          "#EXTINF:10.0,",
          "segment-1.ts",
          "#EXTINF:10.0,",
          "https://video.damplips.com/videos/67284/segment-2.ts",
          "#EXT-X-ENDLIST",
        ].join("\n"),
        { status: 200, headers: { "content-type": "application/x-mpegurl" } },
      ),
    );

    const body = await (
      await GET(new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(playlistUrl)}`))
    ).text();

    expect(body).toContain(proxied("https://video.damplips.com/videos/67284/segment-1.ts"));
    expect(body).toContain(proxied("https://video.damplips.com/videos/67284/segment-2.ts"));
  });

  it("proxies a playlist segment that lives on a media CDN, with a signature", async () => {
    // damplips playlists routinely name their segments on a CDN host. Leaving
    // that URI bare would make the browser fetch it directly and fail on CORS
    // or hotlink protection — the "video could not be loaded" bug.
    const playlistUrl = "https://video.damplips.com/videos/67284/index.m3u8";
    const cdnSegment = "https://media-cdn.example.net/67284/seg-1.ts";
    fetchMock.mockResolvedValueOnce(
      new Response(
        ["#EXTM3U", "#EXTINF:10.0,", cdnSegment, "#EXT-X-ENDLIST"].join("\n"),
        { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } },
      ),
    );

    const body = await (
      await GET(new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(playlistUrl)}`))
    ).text();

    expect(body).not.toContain(`\n${cdnSegment}`);
    const line = body.split("\n").find((entry) => entry.includes("media-cdn.example.net"));
    expect(line).toBeDefined();
    const segmentRequest = new URL(line!, "https://erobabe.test");
    expect(segmentRequest.pathname).toBe("/api/videos/stream");
    expect(segmentRequest.searchParams.get("src")).toBe(cdnSegment);
    expect(segmentRequest.searchParams.get("t")).toBeTruthy();
  });

  it("serves a signed CDN segment, and refuses the same URL without its signature", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(["#EXTM3U", "https://media-cdn.example.net/67284/seg-2.ts"].join("\n"), {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
    );
    const playlistUrl = "https://video.damplips.com/videos/67285/index.m3u8";
    const body = await (
      await GET(new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(playlistUrl)}`))
    ).text();
    const line = body.split("\n").find((entry) => entry.startsWith("/api/videos/stream"))!;

    const signed = await GET(new NextRequest(`https://erobabe.test${line}`, { headers: { range: "bytes=0-3" } }));
    expect(signed.status).toBe(206);

    const unsigned = await GET(
      new NextRequest(
        `https://erobabe.test/api/videos/stream?src=${encodeURIComponent("https://media-cdn.example.net/67284/seg-2.ts")}`,
      ),
    );
    expect(unsigned.status).toBe(403);
  });

  it("refuses a signature minted for a different URL", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(["#EXTM3U", "https://media-cdn.example.net/67284/seg-3.ts"].join("\n"), {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
    );
    const playlistUrl = "https://video.damplips.com/videos/67286/index.m3u8";
    const body = await (
      await GET(new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(playlistUrl)}`))
    ).text();
    const token = new URL(body.split("\n").find((entry) => entry.startsWith("/api/videos/stream"))!, "https://erobabe.test")
      .searchParams.get("t")!;

    const hijacked = await GET(
      new NextRequest(
        `https://erobabe.test/api/videos/stream?src=${encodeURIComponent("https://media-cdn.example.net/other.ts")}&t=${encodeURIComponent(token)}`,
      ),
    );
    expect(hijacked.status).toBe(403);
  });

  it("resolves a damplips post page into the media file it advertises", async () => {
    // A row whose `playable_url` is the HTML post page still plays in our own
    // player: the proxy reads the page and streams the file it names.
    const postPage = "https://www.damplips.com/p/67300/";
    const file = "https://video.damplips.com/videos/67300.mp4";
    fetchMock.mockResolvedValueOnce(
      new Response(
        '<!DOCTYPE html><html><head><meta property="og:video" content="' + file + '" /></head><body></body></html>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    );
    fetchMock.mockResolvedValueOnce(mediaResponse());

    const response = await GET(
      new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(postPage)}`),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(String(fetchMock.mock.calls[1][0])).toBe(file);
    // The page itself was never handed to the player.
    expect(await response.text()).not.toContain("<!DOCTYPE");
  });

  it("reports a post page that publishes no playable file", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<!DOCTYPE html><html><body>removed</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const response = await GET(
      new NextRequest(
        `https://erobabe.test/api/videos/stream?src=${encodeURIComponent("https://www.damplips.com/p/67301/")}`,
      ),
    );
    expect(response.status).toBe(502);
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
      "https://127.0.0.1/video.mp4",
    ]) {
      const response = await GET(
        new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(src)}`),
      );
      expect(response.status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses credentials and malformed URLs", async () => {
    for (const src of [
      "https://user:pass@video.damplips.com/video.mp4",
      "not a url",
    ]) {
      const response = await GET(
        new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(src)}`),
      );
      expect(response.status).toBe(400);
    }
  });

  it("upgrades a plain-http damplips link instead of rejecting it", async () => {
    const response = await GET(
      new NextRequest(
        `https://erobabe.test/api/videos/stream?src=${encodeURIComponent("http://video.damplips.com/videos/1.mp4")}`,
      ),
    );
    expect(response.status).toBe(206);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://video.damplips.com/videos/1.mp4");
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

  it("follows a redirect to a damplips media CDN", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://media-cdn.other-host.net/v/67284.mp4" } }),
    );
    fetchMock.mockResolvedValueOnce(mediaResponse());
    const response = await GET(new NextRequest(PROXY));
    expect(response.status).toBe(206);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://media-cdn.other-host.net/v/67284.mp4");
  });

  it("refuses a redirect into a private network, plain http or a non-URL", async () => {
    for (const location of [
      "http://video.damplips.com/v/1.mp4",
      "https://127.0.0.1/v/1.mp4",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/v/1.mp4",
      "https://admin.internal/v/1.mp4",
    ]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
      const response = await GET(new NextRequest(PROXY));
      expect(response.status).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up after four redirects", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: MEDIA } }));
    const response = await GET(new NextRequest(PROXY));
    expect(response.status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("reports an unreachable or failing media host as a bad gateway", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect((await GET(new NextRequest(PROXY))).status).toBe(502);

    fetchMock.mockResolvedValueOnce(new Response("gone", { status: 404 }));
    expect((await GET(new NextRequest(PROXY))).status).toBe(502);
  });

  it("retries a rejected request without the origin and referer headers", async () => {
    fetchMock.mockResolvedValueOnce(new Response("hotlink", { status: 403 }));
    fetchMock.mockResolvedValueOnce(mediaResponse());

    const response = await GET(new NextRequest(PROXY));

    expect(response.status).toBe(206);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, first] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, second] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((first.headers as Record<string, string>).referer).toBe("https://www.damplips.com/");
    expect((second.headers as Record<string, string>).referer).toBe("https://www.damplips.com/");
    expect((second.headers as Record<string, string>).origin).toBeUndefined();
  });

  it("gives up when every header profile is rejected", async () => {
    fetchMock.mockImplementation(async () => new Response("hotlink", { status: 403 }));
    const response = await GET(new NextRequest(PROXY));
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("answers HEAD without a body", async () => {
    const response = await HEAD(new NextRequest(PROXY, { method: "HEAD" }));
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("");
  });
});

describe("fast playback", () => {
  /**
   * A post page whose head names its file but whose body never finishes. A
   * reader that waits for the whole document (ad scripts, promos, comments)
   * would hold the player here; the proxy must return as soon as the head
   * yields the file.
   */
  function endlessPostPage(file: string) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `<!DOCTYPE html><html><head><meta property="og:title" content="A post">` +
              `<meta property="og:video" content="${file}"></head><body>`,
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    return {
      response: new Response(stream, { status: 200, headers: { "content-type": "text/html" } }),
      wasCancelled: () => cancelled,
    };
  }

  it("starts streaming a post page's file without reading the whole page", async () => {
    const postPage = "https://www.damplips.com/p/67400/";
    const file = "https://video.damplips.com/videos/67400.mp4";
    const page = endlessPostPage(file);
    fetchMock.mockResolvedValueOnce(page.response);
    fetchMock.mockResolvedValueOnce(mediaResponse());

    const response = await GET(
      new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(postPage)}`),
    );

    expect(response.status).toBe(206);
    expect(String(fetchMock.mock.calls[1][0])).toBe(file);
    expect(page.wasCancelled()).toBe(true);
  });

  it("remembers the page → file answer so later byte ranges skip the page", async () => {
    const postPage = "https://www.damplips.com/p/67401/";
    const file = "https://video.damplips.com/videos/67401.mp4";
    fetchMock.mockResolvedValueOnce(
      new Response(`<html><head><meta property="og:video" content="${file}"></head></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    fetchMock.mockResolvedValue(mediaResponse());

    await GET(new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(postPage)}`));
    await GET(
      new NextRequest(`https://erobabe.test/api/videos/stream?src=${encodeURIComponent(postPage)}`, {
        headers: { range: "bytes=1000-2000" },
      }),
    );

    // One page read, then straight to the file for every following request.
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === postPage)).toHaveLength(1);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(file);
  });

  it("lets the browser reuse its copy instead of re-downloading", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { etag: '"v1"', "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT" } }),
    );

    const response = await GET(
      new NextRequest(PROXY, { headers: { range: "bytes=0-3", "if-none-match": '"v1"' } }),
    );

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"v1"');
    expect(await response.text()).toBe("");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["if-none-match"]).toBe('"v1"');
  });

  it("forwards if-range so a seek resumes instead of restarting the download", async () => {
    await GET(
      new NextRequest(PROXY, {
        headers: { range: "bytes=500-999", "if-range": '"v1"' },
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["if-range"]).toBe('"v1"');
  });

  it("marks media cacheable at the edge so a popular video is not one function per range", async () => {
    const response = await GET(new NextRequest(PROXY, { headers: { range: "bytes=0-3" } }));
    const cacheControl = response.headers.get("cache-control") || "";
    expect(cacheControl).toContain("s-maxage=");
    expect(cacheControl).toContain("public");
  });

  it("keeps a playlist's cache window short", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("#EXTM3U\n#EXT-X-ENDLIST\n", {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
    );
    const response = await GET(
      new NextRequest(
        `https://erobabe.test/api/videos/stream?src=${encodeURIComponent("https://video.damplips.com/v/67402/index.m3u8")}`,
      ),
    );
    expect(response.headers.get("cache-control")).toContain("max-age=30");
  });
});

describe("upstream safety", () => {
  it("never leaves a request hanging on a host that does not answer", async () => {
    // A media host that accepts the connection and then says nothing used to
    // hold the function — and the player, on "Preparing video…" — until the
    // platform timed it out. The deadline turns that into a normal failure.
    process.env.MEDIA_UPSTREAM_TIMEOUT_MS = "1000";
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      );

      const pending = GET(new NextRequest(PROXY));
      await vi.advanceTimersByTimeAsync(1_100);
      const response = await pending;

      expect(response.status).toBe(502);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
      delete process.env.MEDIA_UPSTREAM_TIMEOUT_MS;
    }
  });

  it("names the container when the host only says application/octet-stream", async () => {
    // Every response from this app carries `X-Content-Type-Options: nosniff`,
    // so a `<video>` handed a generic binary type is at the mercy of sniffing.
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": "4" },
      }),
    );

    const response = await GET(new NextRequest(PROXY));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });

  it("keeps the type the host declared", async () => {
    const response = await GET(new NextRequest(PROXY));
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });

  it("does not advertise range support the host never offered", async () => {
    // Claiming `bytes` against a host that ignores Range makes a seeking player
    // re-download the whole file on every seek and stall doing it.
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "4" },
      }),
    );
    const response = await GET(new NextRequest(PROXY));
    expect(response.headers.get("accept-ranges")).toBeNull();

    // But a 206 is proof the host understands ranges.
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { "content-type": "video/mp4", "content-range": "bytes 0-3/1000" },
      }),
    );
    const partial = await GET(new NextRequest(PROXY, { headers: { range: "bytes=0-3" } }));
    expect(partial.headers.get("accept-ranges")).toBe("bytes");
  });
});

describe("isPrivateHost", () => {
  it.each([
    "localhost",
    "app.localhost",
    "printer.local",
    "db.internal",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("blocks %s", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(["video.damplips.com", "104.26.0.47", "public-cdn.example.net", "172.32.0.1"])(
    "allows %s",
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    },
  );
});
