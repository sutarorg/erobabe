// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./helpers/video-route-harness";

const state = vi.hoisted(() => ({ client: null as any }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/video/streamtape", () => ({ createDownloadUrl: download }));
import { GET, HEAD } from "@/app/api/videos/[id]/playback/route";

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
function request(id = ID, headers: Record<string, string> = {}, method = "GET") {
  const req = new NextRequest(`http://localhost/api/videos/${id}/playback?file=untrusted&url=https://evil.test/a.mp4`, { headers, method });
  return (method === "HEAD" ? HEAD : GET)(req, { params: Promise.resolve({ id }) });
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
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
