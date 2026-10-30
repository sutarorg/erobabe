// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  released: [] as Array<{ orderId: string; path: string | null; removed: boolean; cleared: boolean }>,
  throws: false,
  revalidated: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/ads/creative-cleanup", () => ({
  releaseFinishedCreatives: async () => {
    if (state.throws) throw new Error("database unavailable");
    return state.released;
  },
}));
vi.mock("@/lib/public/revalidate", () => ({
  revalidatePublicTag: (tag: string) => state.revalidated.push(tag),
}));

import { GET } from "@/app/api/cron/ads-retention/route";

function request(secret?: string) {
  return new Request("https://erobabe.com/api/cron/ads-retention", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  }) as any;
}

beforeEach(() => {
  state.released = [];
  state.throws = false;
  state.revalidated = [];
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/ads-retention", () => {
  it("refuses a missing or wrong secret", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    expect((await GET(request("wrong"))).headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 when no secret is configured at all", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("anything"))).status).toBe(503);
  });

  it("reports how many banners it released", async () => {
    state.released = [
      { orderId: "a", path: "orders/a.webp", removed: true, cleared: true },
      { orderId: "b", path: "orders/b.webp", removed: false, cleared: true },
      { orderId: "c", path: null, removed: true, cleared: true },
    ];
    const response = await GET(request("s3cret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, checked: 3, removed: 1, failed: 1 });
    expect(state.revalidated).toContain("ads");
  });

  it("does not revalidate when nothing had a file", async () => {
    state.released = [{ orderId: "c", path: null, removed: true, cleared: true }];
    await GET(request("s3cret"));
    expect(state.revalidated).toEqual([]);
  });

  it("answers 503 without leaking database detail", async () => {
    state.throws = true;
    const response = await GET(request("s3cret"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "Creative cleanup unavailable" });
    expect(JSON.stringify(body)).not.toContain("database unavailable");
  });
});
