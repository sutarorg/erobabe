// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./helpers/video-route-harness";

const state = vi.hoisted(() => ({ client: null as any }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/video/streamtape", () => ({ createDownloadUrl: download }));
import { GET, HEAD, POST } from "@/app/api/videos/[id]/playback/route";
import { LINK_MAX_AGE_MS, LINK_REFRESH_AFTER_MS, rememberPlaybackAccess, resetPlaybackCache } from "@/lib/video/playback-cache";

const ID = "22222222-2222-4222-8222-222222222222";
const MEDIA = "https://node.tapecontent.net/video.mp4?token=abc";
function setup(overrides = {}) {
  const harness = createHarness({ videos: [{
    id: ID, status: "published", visibility: "public", rights_status: "cleared", moderation_status: "approved",
    playable_url: null, embed_url: "https://streamtape.com/e/Ab123", ...overrides,
  }] });
  state.client = harness.auth;
  return harness;
}
const upstream = vi.fn();
const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
function request(id = ID, headers: Record<string, string> = {}, method = "GET") {
  const req = new NextRequest(`http://localhost/api/videos/${id}/playback?file=untrusted&url=https://evil.test/a.mp4`, { headers, method });
  const handler = method === "HEAD" ? HEAD : method === "POST" ? POST : GET;
  return handler(req, { params: Promise.resolve({ id }) });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
beforeEach(() => {
  resetPlaybackCache();
  info.mockClear();
  warn.mockClear();
  setup();
  download.mockReset().mockResolvedValue(MEDIA);
  upstream.mockReset().mockImplementation(async () => new Response("video bytes", {
    headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": "11" },
  }));
  vi.stubGlobal("fetch", upstream);
});

describe("public playback resolution", () => {
  it("consumes the server-issued ticket on the server and streams non-cacheable media, not a URL", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("video bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(upstream).toHaveBeenCalledWith(MEDIA, expect.objectContaining({ redirect: "manual", cache: "no-store" }));
    expect(download).toHaveBeenCalledWith("Ab123");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
  });
  it.each([
    { status: "draft" }, { visibility: "private" }, { rights_status: "pending" }, { moderation_status: "rejected" },
    { id: "33333333-3333-4333-8333-333333333333" },
  ])("does not resolve unpublished/unapproved/missing entries: %j", async (overrides) => {
    setup(overrides);
    expect((await request()).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects arbitrary IDs", async () => {
    expect((await request("Ab123")).status).toBe(400);
    expect(download).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    { playable_url: "https://cdn.example.com/video.mp4" },
    { embed_url: "https://other.example/e/abc" },
    { embed_url: "https://streamtape.com/unknown" },
  ])("does not resolve other sources: %j", async (overrides) => {
    setup(overrides);
    expect((await request()).status).toBe(422);
    expect(download).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
  it("forwards byte ranges and preserves partial response headers for seeking", async () => {
    upstream.mockResolvedValue(new Response("part", { status: 206, headers: {
      "Content-Type": "video/mp4", "Content-Range": "bytes 10-13/100", "Content-Length": "4", "Accept-Ranges": "bytes",
      "Set-Cookie": "upstream=secret", "Location": MEDIA,
    } }));
    const response = await request(ID, { Range: "bytes=10-13", Cookie: "session=private", Authorization: "Bearer secret" });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("part");
    expect(response.headers.get("content-range")).toBe("bytes 10-13/100");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    const headers = upstream.mock.calls[0][1].headers as Headers;
    expect(headers.get("range")).toBe("bytes=10-13");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });
  it("answers HEAD metadata probes without a media body", async () => {
    const response = await request(ID, {}, "HEAD");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-length")).toBe("11");
    expect(upstream.mock.calls[0][1].method).toBe("HEAD");
  });
  it("rejects malformed/multipart ranges before calling the provider", async () => {
    expect((await request(ID, { Range: "bytes=0-1,10-20" })).status).toBe(400);
    expect(download).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
  it("does not expose upstream HTML errors as playable media", async () => {
    upstream.mockResolvedValue(new Response("provider secret error", { status: 403, headers: { "Content-Type": "text/html" } }));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|token=abc/);
  });
  it("resolves legacy watch pages stored as playable URLs", async () => {
    setup({ playable_url: "https://streamtape.com/v/Legacy123/name.mp4" });
    expect((await request()).status).toBe(200);
    expect(download).toHaveBeenCalledWith("Legacy123");
  });
  it("does not expose upstream errors or credentials", async () => {
    download.mockRejectedValue(new Error("https://api.streamtape.com/?login=user&key=secret"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|login|key/);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects player pages or untrusted URLs returned by the API", async () => {
    download.mockResolvedValue("https://evil.example/video.mp4");
    expect((await request()).status).toBe(503);
  });
});

describe("instant start: the Streamtape handshake is not repeated per request", () => {
  const media = (body = "x") => new Response(body, { status: 206, headers: {
    "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/100", "Content-Length": String(body.length), "Accept-Ranges": "bytes",
  } });
  beforeEach(() => { upstream.mockReset().mockImplementation(async () => media()); });

  it("resolves the link once and reuses it for the browser's start-up and seek ranges", async () => {
    for (const range of ["bytes=0-", "bytes=99000000-", "bytes=48-", "bytes=50000000-"]) {
      const response = await request(ID, { Range: range });
      expect(response.status).toBe(206);
      await response.text();
    }
    // Before: one ticket (and one ~10 s wait_time) per range request.
    expect(download).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(upstream.mock.calls.map(([, init]) => (init.headers as Headers).get("range")))
      .toEqual(["bytes=0-", "bytes=99000000-", "bytes=48-", "bytes=50000000-"]);
  });

  it("lets concurrent range requests share a single in-flight handshake", async () => {
    let finish!: (url: string) => void;
    download.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const pending = [request(ID, { Range: "bytes=0-" }), request(ID, { Range: "bytes=99000000-" }), request(ID, {}, "HEAD")];
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    finish(MEDIA);
    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status)).toEqual([206, 206, 206]);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("checks the catalogue once, then trusts the decision briefly for range and seek requests", async () => {
    const from = vi.spyOn(state.client, "from");
    await (await request(ID, { Range: "bytes=0-" })).text();
    await (await request(ID, { Range: "bytes=500-" })).text();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("re-checks the catalogue once the access decision has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const from = vi.spyOn(state.client, "from");
    await (await request()).text();
    setup({ status: "draft" });
    const unpublished = vi.spyOn(state.client, "from");
    vi.setSystemTime(Date.now() + 61_000);
    expect((await request()).status).toBe(404);
    expect(from).toHaveBeenCalledTimes(1);
    expect(unpublished).toHaveBeenCalledTimes(1);
  });

  it("never caches a failed access check", async () => {
    setup({ status: "draft" });
    expect((await request()).status).toBe(404);
    setup();
    expect((await request()).status).toBe(206);
  });

  it("transparently re-resolves an expired cached link once and keeps playing", async () => {
    const FRESH = "https://node.tapecontent.net/video.mp4?token=fresh";
    download.mockResolvedValueOnce(MEDIA).mockResolvedValueOnce(FRESH);
    await (await request(ID, { Range: "bytes=0-" })).text();
    upstream.mockImplementation(async (url: string) => url === MEDIA
      ? new Response("expired", { status: 403, headers: { "Content-Type": "text/html" } })
      : media("ok"));
    const response = await request(ID, { Range: "bytes=500-" });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("ok");
    expect(download).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls.map(([url]) => url)).toEqual([MEDIA, MEDIA, FRESH]);
    // The fresh link is now the cached one.
    await (await request(ID, { Range: "bytes=900-" })).text();
    expect(download).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls.at(-1)?.[0]).toBe(FRESH);
  });

  it("logs the refusal and the retry so link lifetimes show up in the hosting logs", async () => {
    const FRESH = "https://node.tapecontent.net/video.mp4?token=fresh";
    download.mockResolvedValueOnce(MEDIA).mockResolvedValueOnce(FRESH);
    await (await request(ID, { Range: "bytes=0-" })).text();
    upstream.mockImplementation(async (url: string) => url === MEDIA
      ? new Response("expired", { status: 410, headers: { "Content-Type": "text/html" } })
      : media("ok"));
    await (await request(ID, { Range: "bytes=500-" })).text();
    expect(warn.mock.calls.map(([line]) => line.replace(/[\d.]+ s old/, "N s old"))).toEqual([
      "[playback] Media host did not serve video for a Streamtape link (file Ab123, HTTP 410, N s old); retrying with a fresh link",
    ]);
    expect(info.mock.calls.map(([line]) => line.replace(/in [\d.]+ s/, "in N s"))).toEqual([
      "[playback] Streamtape link ready in N s (file Ab123, request)",
      "[playback] Streamtape link ready in N s (file Ab123, request)",
    ]);
    expect([...info.mock.calls, ...warn.mock.calls].flat().join(" ")).not.toContain("token");
  });

  it("does not repeat a handshake it has only just made, and does not reuse the rejected link", async () => {
    upstream.mockImplementation(async () => new Response("denied", { status: 403, headers: { "Content-Type": "text/html" } }));
    expect((await request()).status).toBe(503);
    expect(download).toHaveBeenCalledTimes(1);
    expect((await request()).status).toBe(503);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("does not throw a working link away when the visitor cancels", async () => {
    await (await request()).text();
    const controller = new AbortController();
    upstream.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const req = new NextRequest(`http://localhost/api/videos/${ID}/playback`, { signal: controller.signal });
    const cancelled = GET(req, { params: Promise.resolve({ id: ID }) });
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(2));
    controller.abort();
    expect((await cancelled).status).toBe(503);
    upstream.mockImplementation(async () => media());
    expect((await request()).status).toBe(206);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("refreshes an ageing link in the background without making the viewer wait", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const FRESH = "https://node.tapecontent.net/video.mp4?token=fresh";
    download.mockResolvedValueOnce(MEDIA).mockResolvedValueOnce(FRESH);
    await (await request()).text();
    vi.setSystemTime(Date.now() + LINK_REFRESH_AFTER_MS + 1_000);
    rememberPlaybackAccess(ID, "Ab123");
    await (await request()).text();
    expect(upstream.mock.calls.at(-1)?.[0]).toBe(MEDIA);
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    await (await request()).text();
    expect(upstream.mock.calls.at(-1)?.[0]).toBe(FRESH);
  });

  it("never uses a link past its maximum age", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const FRESH = "https://node.tapecontent.net/video.mp4?token=fresh";
    download.mockResolvedValueOnce(MEDIA).mockResolvedValueOnce(FRESH);
    await (await request()).text();
    vi.setSystemTime(Date.now() + LINK_MAX_AGE_MS + 1_000);
    await (await request()).text();
    expect(download).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls.at(-1)?.[0]).toBe(FRESH);
  });
});

describe("POST prepare: warming playback before Play is pressed", () => {
  it("resolves the link ahead of time without returning it or touching media", async () => {
    const response = await request(ID, {}, "POST");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(download).toHaveBeenCalledWith("Ab123");
    expect(upstream).not.toHaveBeenCalled();
    // Pressing Play now streams straight away, with no second handshake.
    expect((await request(ID, { Range: "bytes=0-" })).status).toBe(200);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("joins a handshake that is already running instead of starting another", async () => {
    let finish!: (url: string) => void;
    download.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const prepare = request(ID, {}, "POST");
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const play = request(ID, { Range: "bytes=0-" });
    finish(MEDIA);
    expect((await prepare).status).toBe(204);
    expect((await play).status).toBe(200);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it.each([{ status: "draft" }, { moderation_status: "rejected" }])("applies the same catalogue checks: %j", async (overrides) => {
    setup(overrides);
    expect((await request(ID, {}, "POST")).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("rejects arbitrary IDs and non-Streamtape sources", async () => {
    expect((await request("Ab123", {}, "POST")).status).toBe(400);
    setup({ playable_url: "https://cdn.example.com/video.mp4" });
    expect((await request(ID, {}, "POST")).status).toBe(422);
    expect(download).not.toHaveBeenCalled();
  });

  it("does not expose provider errors or credentials", async () => {
    download.mockRejectedValue(new Error("https://api.streamtape.com/?login=user&key=secret"));
    const response = await request(ID, {}, "POST");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|login|key=/);
  });
});

