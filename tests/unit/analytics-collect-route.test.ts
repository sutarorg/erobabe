// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, any> }>,
  allowed: true,
  activityError: null as any,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: Record<string, any>) => {
      state.calls.push({ name, args });
      if (name === "consume_request") {
        return state.allowed ? { data: true, error: null } : { data: false, error: null };
      }
      return { data: null, error: state.activityError };
    },
  }),
}));

import { POST } from "@/app/api/analytics/collect/route";

const SESSION = "11111111-1111-4111-8111-111111111111";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://erobabe.com/api/analytics/collect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      "x-real-ip": "203.0.113.9",
      host: "erobabe.com",
      "x-vercel-ip-country": "us",
      "x-vercel-ip-country-region": "California",
      "x-vercel-ip-city": "Los%20Angeles",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const pageview = {
  sessionId: SESSION,
  path: "/video/abc/",
  search: "?utm_source=reddit&utm_medium=social",
  referrer: "https://www.google.com/search?q=erobabe",
};

const activity = () => state.calls.find((call) => call.name === "record_analytics_activity");

beforeEach(() => {
  state.calls = [];
  state.allowed = true;
  state.activityError = null;
  vi.stubEnv("ANALYTICS_HASH_SECRET", "test-secret");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/analytics/collect", () => {
  it("records a normalised pageview with derived, non-identifying context", async () => {
    const response = await POST(request(pageview));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ recorded: true });

    const call = activity();
    expect(call).toBeTruthy();
    expect(call!.args).toMatchObject({
      p_session: SESSION,
      p_path: "/video/abc",
      p_previous_path: null,
      p_device: "mobile",
      p_browser: "Safari",
      p_os: "iOS",
      p_country: "US",
      p_region: "California",
      p_city: "Los Angeles",
      p_referrer_host: "google.com",
      p_referrer_path: "/search",
      p_utm_source: "reddit",
      p_utm_medium: "social",
      p_utm_campaign: null,
      p_previous_engaged_ms: 0,
    });
    // A keyed hash, never the address or the user-agent string.
    expect(call!.args.p_visitor).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(call!.args)).not.toContain("203.0.113.9");
    expect(JSON.stringify(call!.args)).not.toContain("iPhone");
    expect(JSON.stringify(call!.args)).not.toContain("q=erobabe");
  });

  it("flushes time on the page being left without adding a pageview", async () => {
    const response = await POST(
      request({ sessionId: SESSION, path: null, previousPath: "/latest", previousEngagedMs: 12_345 }),
    );
    expect(response.status).toBe(202);
    expect(activity()!.args).toMatchObject({
      p_path: null,
      p_previous_path: "/latest",
      p_previous_engaged_ms: 12_345,
    });
  });

  it("acknowledges but ignores crawlers and scripted clients", async () => {
    const response = await POST(
      request(pageview, { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ recorded: false, reason: "automated" });
    expect(activity()).toBeUndefined();
    expect(state.calls.some((call) => call.name === "consume_request")).toBe(false);
  });

  it("never stores a private surface", async () => {
    const response = await POST(request({ ...pageview, path: "/admin/analytics" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ recorded: false, reason: "unmeasured-path" });
    expect(activity()).toBeUndefined();
  });

  it("drops an internal referrer", async () => {
    await POST(request({ ...pageview, referrer: "https://erobabe.com/latest" }));
    expect(activity()!.args.p_referrer_host).toBeNull();
  });

  it("rejects malformed bodies and unknown fields", async () => {
    expect((await POST(request({ sessionId: "not-a-uuid", path: "/" }))).status).toBe(400);
    expect((await POST(request({ ...pageview, extra: true }))).status).toBe(400);
    expect((await POST(request({ sessionId: SESSION, path: null }))).status).toBe(400);
    expect(
      (
        await POST(
          new Request("https://erobabe.com/api/analytics/collect", {
            method: "POST",
            headers: { "user-agent": "Mozilla/5.0 Chrome/126" },
            body: "not json",
          }),
        )
      ).status,
    ).toBe(415);
  });

  it("rate-limits a flood with 429 and writes nothing", async () => {
    state.allowed = false;
    const response = await POST(request(pageview));
    expect(response.status).toBe(429);
    expect(activity()).toBeUndefined();
  });

  it("answers 503 without leaking database detail when storage fails", async () => {
    state.activityError = { code: "42P01", message: 'relation "analytics_pageviews" does not exist' };
    const response = await POST(request(pageview));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "Analytics unavailable" });
    expect(JSON.stringify(body)).not.toContain("analytics_pageviews");
  });

  it("is never cached", async () => {
    const response = await POST(request(pageview));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
