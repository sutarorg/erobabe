import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, getRequest } from "./helpers/video-route-harness";

const state = vi.hoisted(() => ({ client: null as any }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/video/streamtape", () => ({ createDownloadUrl: download }));
import { GET } from "@/app/api/videos/[id]/playback/route";

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
function request(id = ID) {
  return GET(getRequest(`/api/videos/${id}/playback?file=untrusted`), { params: Promise.resolve({ id }) });
}
beforeEach(() => {
  setup();
  download.mockReset().mockResolvedValue(MEDIA);
});

describe("public playback resolution", () => {
  it("uses only the catalog file ID and returns non-cacheable media JSON, not a redirect", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: MEDIA });
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
  });
  it("rejects arbitrary IDs", async () => {
    expect((await request("Ab123")).status).toBe(400);
    expect(download).not.toHaveBeenCalled();
  });
  it.each([
    { playable_url: "https://cdn.example.com/video.mp4" },
    { embed_url: "https://other.example/e/abc" },
    { embed_url: "https://streamtape.com/unknown" },
  ])("does not resolve other sources: %j", async (overrides) => {
    setup(overrides);
    expect((await request()).status).toBe(422);
    expect(download).not.toHaveBeenCalled();
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
