// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  actionResult: { error: null as any },
  order: null as any,
  removed: [] as string[],
  updates: [] as Array<Record<string, any>>,
  revalidated: [] as string[],
}));

vi.mock("@/lib/video/publishing", () => ({
  requireActiveAdmin: async () => ({ user: { id: "admin-1" }, service: SERVICE }),
  errorStatusFrom: () => 500,
}));

vi.mock("@/lib/public/revalidate", () => ({
  revalidatePublicTag: (tag: string) => state.revalidated.push(tag),
}));

vi.mock("@/lib/resend/client", () => ({
  sendEmail: vi.fn(),
  templateAdLive: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => null }));

import { POST } from "@/app/api/admin/advertisements/route";

const SERVICE = {
  rpc: async () => state.actionResult,
  storage: {
    from: () => ({
      remove: async (paths: string[]) => {
        state.removed.push(...paths);
        return { error: null };
      },
    }),
  },
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: state.order, error: null }),
        single: async () => ({ data: state.order, error: null }),
      }),
    }),
    update: (patch: Record<string, any>) => ({
      eq: async () => {
        state.updates.push({ table, ...patch });
        return { error: null };
      },
    }),
  }),
};

async function call(action: string) {
  return POST(
    new Request("https://erobabe.com/api/admin/advertisements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "77777777-7777-4777-8777-777777777777", action }),
    }),
  );
}

beforeEach(() => {
  state.actionResult = { error: null };
  state.removed = [];
  state.updates = [];
  state.revalidated = [];
  state.order = {
    id: "77777777-7777-4777-8777-777777777777",
    image_path: "orders/banner.webp",
    image_url: "https://cdn.example.com/banner.webp",
    status: "rejected",
  };
});

afterEach(() => vi.restoreAllMocks());

describe("rejecting an advertisement", () => {
  it("deletes the banner from storage and clears it from the order", async () => {
    const response = await call("reject_ad");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      updated: true,
      action: "reject_ad",
      creativeRemoved: true,
      creativeRemovalFailed: false,
    });
    expect(state.removed).toEqual(["orders/banner.webp"]);
    expect(state.updates).toEqual([
      { table: "ad_orders", image_url: null, image_path: null },
    ]);
  });

  it("revalidates the public ad surfaces after the banner disappears", async () => {
    await call("reject_ad");
    expect(state.revalidated).toContain("ads");
  });

  it("does not touch storage for actions that keep the creative", async () => {
    state.actionResult = { error: null };
    const response = await call("make_live");
    expect(response.status).toBe(200);
    expect(state.removed).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("refuses to act when the review RPC fails", async () => {
    state.actionResult = { error: { message: "Only an ad in review can be rejected" } };
    const response = await call("reject_ad");
    expect(response.status).toBe(409);
    // Nothing is deleted when the state change did not happen.
    expect(state.removed).toEqual([]);
    expect(state.updates).toEqual([]);
  });
});
