import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const viewerHashFromCookie = vi.fn();
const upsert = vi.fn(async () => ({ error: null }));
const limitRequest = vi.fn(async () => "limited");
vi.mock("@/lib/http/safety", () => ({
  boundedJson: async (request: Request) => JSON.parse(await request.text()),
  limitRequest: (..._args: unknown[]) => limitRequest(),
  RequestError: class RequestError extends Error { status = 503; },
}));
vi.mock("@/lib/recommendations/service", () => ({
  RECOMMENDATION_COOKIE: "erobabe-rec-profile",
  viewerHashFromCookie: (...args: unknown[]) => viewerHashFromCookie(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: () => ({ upsert }) }),
}));

const { GET, POST } = await import("@/app/api/recommendations/preferences/route");
const originalSecret = process.env.ANALYTICS_HASH_SECRET;
afterEach(() => {
  vi.clearAllMocks();
  if (originalSecret === undefined) delete process.env.ANALYTICS_HASH_SECRET;
  else process.env.ANALYTICS_HASH_SECRET = originalSecret;
});

describe("recommendation privacy preferences", () => {
  it("defaults to off with a private, uncached response", async () => {
    viewerHashFromCookie.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("requires a same-origin JSON action and issues an opaque HttpOnly opt-in cookie", async () => {
    process.env.ANALYTICS_HASH_SECRET = "test-only-secret";
    viewerHashFromCookie.mockResolvedValue(null);
    const response = await POST(new NextRequest("https://site.test/api/recommendations/preferences", {
      method: "POST",
      headers: { origin: "https://site.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "enable" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, reset: false });
    expect(upsert).toHaveBeenCalledOnce();
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain("erobabe-rec-profile=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Max-Age=15552000");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("rejects cross-origin preference changes before any profile write", async () => {
    const response = await POST(new NextRequest("https://site.test/api/recommendations/preferences", {
      method: "POST",
      headers: { origin: "https://attacker.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "enable" }),
    }));
    expect(response.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
    expect(limitRequest).not.toHaveBeenCalled();
  });
});
