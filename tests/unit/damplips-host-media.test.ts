import { describe, expect, it, vi } from "vitest";
import { fetchHostMediaUrl } from "@/lib/damplips/host-media";

describe("fetchHostMediaUrl", () => {
  it("returns the redirected file URL when the host serves video", async () => {
    const fetchImpl = vi.fn(async () => {
      const response = new Response("ftypisom", {
        status: 206,
        headers: { "content-type": "video/mp4" },
      });
      Object.defineProperty(response, "url", {
        value: "https://video.damplips.com/cdn/79.mp4",
      });
      return response;
    });

    await expect(
      fetchHostMediaUrl("https://video.damplips.com/video7/717/79.mp4", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBe("https://video.damplips.com/cdn/79.mp4");

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Range: "bytes=0-1023" });
  });

  it("refuses a host that answers with a document instead of a file", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html>block</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      fetchHostMediaUrl("https://video.damplips.com/videos/1.mp4", { fetchImpl }),
    ).resolves.toBeNull();
  });

  it("does not fetch a playlist or a post page", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      fetchHostMediaUrl("https://video.damplips.com/v/1/index.m3u8", { fetchImpl }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
