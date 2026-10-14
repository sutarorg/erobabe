// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamtapeMediaError, streamStreamtapeMedia, validMediaRange } from "@/lib/video/streamtape-media";

const URL = "https://node.tapecontent.net/video.mp4?token=private";
const request = (init?: RequestInit) => new Request("https://site.example/api/videos/id/playback", init);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("media byte ranges", () => {
  it.each(["bytes=0-", "bytes=0-1", "bytes=10-20", "bytes=-500"])("accepts %s", (range) => {
    expect(validMediaRange(range)).toBe(true);
  });
  it.each(["bytes=-", "bytes=-0", "bytes=10-2", "bytes=0-1,4-5", "bytes=1e3-", "bytes=9007199254740992-", "items=0-1"])("rejects %s", (range) => {
    expect(validMediaRange(range)).toBe(false);
  });
});

describe("server-side Streamtape media streaming", () => {
  it("follows only validated provider redirects, preserving ranges", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://cdn.tapecontent.net/a.mp4" } }))
      .mockResolvedValueOnce(new Response("ab", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-1/100", "Content-Length": "2" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await streamStreamtapeMedia(URL, request({ headers: { Range: "bytes=0-1" } }));
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("ab");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("https://cdn.tapecontent.net/a.mp4");
    for (const [, options] of fetch.mock.calls) {
      expect(options.redirect).toBe("manual");
      expect(options.headers.get("range")).toBe("bytes=0-1");
    }
  });
  it.each([
    "https://evil.example/a.mp4", "http://127.0.0.1/private", "https://streamtape.com/e/abc",
    "https://api.streamtape.com/account/info", "https://node.tapecontent.net/a.mp4?key=secret",
  ])("rejects unsafe redirect %s before fetching it", async (location) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }));
    vi.stubGlobal("fetch", fetch);
    await expect(streamStreamtapeMedia(URL, request())).rejects.toThrow("Video media unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("limits redirect loops", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { Location: URL } }));
    vi.stubGlobal("fetch", fetch);
    await expect(streamStreamtapeMedia(URL, request())).rejects.toThrow("Video media unavailable");
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it.each(["text/html", "application/json", "application/javascript", "image/svg+xml"])("never relays %s even on HTTP 200", async (type) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret", { headers: { "Content-Type": type } })));
    await expect(streamStreamtapeMedia(URL, request())).rejects.toThrow("Video media unavailable");
  });
  it("returns an unsatisfied range without forwarding the upstream error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret", { status: 416, headers: { "Content-Range": "bytes */100" } })));
    const response = await streamStreamtapeMedia(URL, request({ headers: { Range: "bytes=200-" } }));
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */100");
    expect(await response.text()).toBe("");
  });
  it("rejects partial media with no content range", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("part", { status: 206, headers: { "Content-Type": "video/mp4" } })));
    await expect(streamStreamtapeMedia(URL, request())).rejects.toThrow("Video media unavailable");
  });
  it("streams before the whole upstream file arrives and cancels on disconnect", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("first chunk")); },
      cancel,
    });
    const fetch = vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await streamStreamtapeMedia(URL, request());
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("first chunk");
    await reader.cancel();
    expect(cancel).toHaveBeenCalled();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("propagates request aborts to the upstream fetch", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(new Response("video", { headers: { "Content-Type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await streamStreamtapeMedia(URL, request({ signal: controller.signal }));
    controller.abort();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await response.body!.cancel();
  });
  it("times out stalled upstream headers without disclosing the ticket", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error(URL)), { once: true });
    })));
    const result = expect(streamStreamtapeMedia(URL, request())).rejects.toThrow("Video media unavailable");
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
  });
  it("does not apply the connection timeout to an active media body", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(new Response("video", { headers: { "Content-Type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await streamStreamtapeMedia(URL, request());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    expect(await response.text()).toBe("video");
  });
});

describe("telling an expired link apart from a visitor who left", () => {
  const failure = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error("expected a failure"); },
    (error: unknown) => error as StreamtapeMediaError,
  );
  it.each([
    ["a 403 refusal", () => new Response("expired", { status: 403, headers: { "Content-Type": "text/html" } }), 403],
    ["a 404", () => new Response(null, { status: 404 }), 404],
    ["an HTML page on HTTP 200", () => new Response("<html>", { headers: { "Content-Type": "text/html" } }), 200],
  ])("marks %s as retryable with a fresh link", async (_label, make, status) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => make()));
    const error = await failure(streamStreamtapeMedia(URL, request()));
    expect(error).toBeInstanceOf(StreamtapeMediaError);
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(status);
    expect(error.message).toBe("Video media unavailable");
    expect(error.message).not.toContain("token");
  });
  it("reports the status of the hop that failed, not of an earlier redirect", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://node2.tapecontent.net/v.mp4" } }))
      .mockRejectedValueOnce(new TypeError("fetch failed")));
    const error = await failure(streamStreamtapeMedia(URL, request()));
    expect(error.retryable).toBe(true);
    expect(error.status).toBeNull();
  });
  it("does not retry when the visitor cancelled", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    const pending = failure(streamStreamtapeMedia(URL, request({ signal: controller.signal })));
    controller.abort();
    const error = await pending;
    expect(error.retryable).toBe(false);
    expect(error.status).toBeNull();
  });
  it("does not retry when the media host never answered", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error(URL)), { once: true });
    })));
    const pending = failure(streamStreamtapeMedia(URL, request()));
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).retryable).toBe(false);
  });
});

