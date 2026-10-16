import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const latestRecommendations = vi.fn();
const getRecommendationFeed = vi.fn();
const viewerHashFromCookie = vi.fn();
vi.mock("@/lib/http/safety", () => ({
  boundedJson: async (request: Request) => JSON.parse(await request.text()),
  limitRequest: vi.fn(async () => "rate-key"),
  RequestError: class RequestError extends Error { status = 503; },
}));
vi.mock("@/lib/recommendations/service", () => ({
  latestRecommendations: (...args: unknown[]) => latestRecommendations(...args),
  getRecommendationFeed: (...args: unknown[]) => getRecommendationFeed(...args),
  viewerHashFromCookie: (...args: unknown[]) => viewerHashFromCookie(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({}) }));

const { GET: feed } = await import("@/app/api/videos/feed/route");
const { POST: events } = await import("@/app/api/recommendations/events/route");
const { POST: feedback } = await import("@/app/api/recommendations/feedback/route");

afterEach(() => vi.clearAllMocks());

describe("recommendation endpoints", () => {
  it("rejects incomplete and malformed feed cursors before running queries", async () => {
    const missingContext = await feed(new NextRequest("https://site.test/api/videos/feed?surface=up_next"));
    expect(missingContext.status).toBe(400);
    const invalidCursor = await feed(new NextRequest("https://site.test/api/videos/feed?surface=latest&date=bad&id=11111111-1111-4111-8111-111111111111"));
    expect(invalidCursor.status).toBe(400);
    expect(latestRecommendations).not.toHaveBeenCalled();
    expect(getRecommendationFeed).not.toHaveBeenCalled();
  });

  it("routes latest and context feeds to distinct handlers and disables shared caching", async () => {
    latestRecommendations.mockResolvedValueOnce({ videos: [], cursor: null });
    const latest = await feed(new NextRequest("https://site.test/api/videos/feed?exclude=11111111-1111-4111-8111-111111111111&limit=8"));
    expect(latest.status).toBe(200);
    expect(latest.headers.get("Cache-Control")).toBe("private, no-store");
    expect(latestRecommendations).toHaveBeenCalledWith({ exclude: "11111111-1111-4111-8111-111111111111", cursor: undefined, limit: 8 });

    getRecommendationFeed.mockResolvedValueOnce({ videos: [], cursor: null, personalized: false, correlationId: "test", algorithmVersion: "erobabe-rec-v1" });
    const upNext = await feed(new NextRequest("https://site.test/api/videos/feed?surface=up_next&exclude=11111111-1111-4111-8111-111111111111"));
    expect(upNext.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getRecommendationFeed).toHaveBeenCalledWith({ surface: "up_next", currentVideoId: "11111111-1111-4111-8111-111111111111", cursor: undefined, limit: 16 });
  });

  it("validates analytics before consent handling and accepts no private data without opt-in", async () => {
    viewerHashFromCookie.mockResolvedValue(null);
    const invalid = await events(new NextRequest("https://site.test/api/recommendations/events", { method: "POST", headers: { "content-type": "application/json", origin: "https://site.test" }, body: JSON.stringify({ events: [{ videoId: "nope" }] }) }));
    expect(invalid.status).toBe(400);
    const valid = await events(new NextRequest("https://site.test/api/recommendations/events", { method: "POST", headers: { "content-type": "application/json", origin: "https://site.test" }, body: JSON.stringify({ events: [{ videoId: "11111111-1111-4111-8111-111111111111", type: "impression", surface: "recommended", position: 0, algorithmVersion: "erobabe-rec-v1", correlationId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "33333333-3333-4333-8333-333333333333" }] }) }));
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ accepted: 0, personalization: false });
  });

  it("rejects cross-origin feedback and malformed action payloads", async () => {
    const crossOrigin = await feedback(new NextRequest("https://site.test/api/recommendations/feedback", { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.test" }, body: "{}" }));
    expect(crossOrigin.status).toBe(403);
    const malformed = await feedback(new NextRequest("https://site.test/api/recommendations/feedback", { method: "POST", headers: { "content-type": "application/json", origin: "https://site.test" }, body: JSON.stringify({ videoId: "bad", action: "clickbait" }) }));
    expect(malformed.status).toBe(400);
  });
});
