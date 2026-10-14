// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./helpers/video-route-harness";

const state = vi.hoisted(() => ({ client: null as any }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/video/streamtape", () => ({ createDownloadUrl: download }));
import { POST } from "@/app/api/videos/[id]/prepare/route";
import { clearStreamtapeTicketCache, streamtapeTicketCacheSize } from "@/lib/video/streamtape-tickets";

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

function prepare(id = ID) {
  const request = new NextRequest(`http://localhost/api/videos/${id}/prepare`, { method: "POST" });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  clearStreamtapeTicketCache();
  setup();
  download.mockReset().mockResolvedValue(MEDIA);
});
afterEach(() => vi.unstubAllGlobals());

describe("watch-page warm-up", () => {
  it("resolves the media link before the click and never returns the URL", async () => {
    const response = await prepare();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ready: true, provider: "streamtape" });
    expect(JSON.stringify(body)).not.toMatch(/https?:|token|streamtape\.net/i);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(download).toHaveBeenCalledWith("Ab123");
    expect(streamtapeTicketCacheSize()).toBe(1);

    // The click (and the page's own preload) then reuse the cached link.
    expect((await prepare()).status).toBe(200);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "draft" }, { visibility: "private" }, { rights_status: "pending" }, { moderation_status: "rejected" },
    { id: "33333333-3333-4333-8333-333333333333" },
  ])("re-checks catalog access before warming anything: %j", async (overrides) => {
    setup(overrides);
    expect((await prepare()).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
    expect(streamtapeTicketCacheSize()).toBe(0);
  });

  it("rejects arbitrary IDs", async () => {
    expect((await prepare("Ab123")).status).toBe(400);
    expect(download).not.toHaveBeenCalled();
  });

  it("has nothing to do for a direct source the browser fetches itself", async () => {
    setup({ playable_url: "https://cdn.example.com/video.mp4", embed_url: null });
    const response = await prepare();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true, provider: "direct" });
    expect(download).not.toHaveBeenCalled();
  });

  it("reports an unusable entry instead of pretending it is ready", async () => {
    setup({ embed_url: "https://streamtape.com/unknown", playable_url: null });
    const response = await prepare();
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ready: false, reason: "unavailable" });
  });

  it("fails closed without leaking provider errors or credentials", async () => {
    download.mockRejectedValue(new Error("https://api.streamtape.com/?login=user&key=secret"));
    const response = await prepare();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toMatch(/secret|login=|key=/);
    expect(streamtapeTicketCacheSize()).toBe(0);
  });

  it("does not cache a link that is not an allowlisted media host", async () => {
    download.mockResolvedValue("https://evil.example/video.mp4");
    expect((await prepare()).status).toBe(503);
    expect(streamtapeTicketCacheSize()).toBe(0);
  });
});
