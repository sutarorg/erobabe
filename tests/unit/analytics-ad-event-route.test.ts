// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, any> }>,
  allowed: true,
  recorded: true,
  error: null as any,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: Record<string, any>) => {
      state.calls.push({ name, args });
      if (name === "consume_request") {
        return state.allowed ? { data: true, error: null } : { data: false, error: null };
      }
      return { data: state.recorded, error: state.error };
    },
  }),
}));

import { POST } from "@/app/api/track/ad/route";

const ORDER = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";

function request(body: unknown) {
  return new Request("https://erobabe.com/api/track/ad", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36",
      "x-real-ip": "198.51.100.7",
    },
    body: JSON.stringify(body),
  });
}

const event = { eventId: EVENT, orderId: ORDER, slotId: 3, kind: "impression" };
const recorded = () => state.calls.find((call) => call.name === "record_ad_order_event");

beforeEach(() => {
  state.calls = [];
  state.allowed = true;
  state.recorded = true;
  state.error = null;
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/track/ad", () => {
  it("records an impression against the live order", async () => {
    const response = await POST(request(event));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ recorded: true });
    expect(recorded()!.args).toMatchObject({
      p_id: EVENT,
      p_order: ORDER,
      p_slot: 3,
      p_kind: "impression",
    });
    expect(recorded()!.args.p_visitor).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(recorded()!.args)).not.toContain("198.51.100.7");
  });

  it("records a click", async () => {
    await POST(request({ ...event, kind: "click" }));
    expect(recorded()!.args.p_kind).toBe("click");
  });

  it("reports a duplicate or non-live order as not recorded", async () => {
    state.recorded = false;
    const response = await POST(request(event));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ recorded: false });
  });

  it("rejects an invalid slot, kind or id", async () => {
    expect((await POST(request({ ...event, slotId: 11 }))).status).toBe(400);
    expect((await POST(request({ ...event, slotId: 0 }))).status).toBe(400);
    expect((await POST(request({ ...event, kind: "view" }))).status).toBe(400);
    expect((await POST(request({ ...event, orderId: "nope" }))).status).toBe(400);
    expect((await POST(request({ ...event, campaignId: "x" }))).status).toBe(400);
    expect(recorded()).toBeUndefined();
  });

  it("rate-limits with 429", async () => {
    state.allowed = false;
    expect((await POST(request(event))).status).toBe(429);
    expect(recorded()).toBeUndefined();
  });

  it("answers 503 without database detail when the function fails", async () => {
    state.error = { code: "42883", message: 'function record_ad_order_event does not exist' };
    const response = await POST(request(event));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Event unavailable" });
  });

  it("is never cached", async () => {
    expect((await POST(request(event))).headers.get("cache-control")).toBe("no-store");
  });
});
