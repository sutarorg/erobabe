// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  service: null as any,
  order: null as any,
  removed: [] as string[],
  audits: [] as any[],
  deletedIds: [] as string[],
}));

vi.mock("@/lib/video/publishing", () => ({
  requireActiveAdmin: async () => ({ user: { id: "admin-1" }, service: state.service }),
  errorStatusFrom: () => 500,
}));
vi.mock("@/lib/public/revalidate", () => ({ revalidatePublicTag: vi.fn() }));
vi.mock("@/lib/resend/client", () => ({ sendEmail: vi.fn(), templateAdLive: vi.fn() }));

import { POST } from "@/app/api/admin/advertisements/route";

function request(action: string) {
  return new Request("https://example.com/api/admin/advertisements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "88888888-8888-4888-8888-888888888888", action }),
  });
}

function liveOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    slot_id: 3,
    ad_name: "Summer launch",
    status: "live",
    payment_status: "verified",
    amount_cents: 9900,
    starts_at: "2026-10-01T00:00:00.000Z",
    ends_at: "2026-10-31T00:00:00.000Z",
    image_path: "orders/banner.png",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.removed = [];
  state.audits = [];
  state.deletedIds = [];
  state.order = liveOrder();
  state.from.mockImplementation((table: string) => {
    if (table === "ad_orders") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.order, error: null }) }) }),
        delete: () => ({
          eq: async (_column: string, value: string) => {
            state.deletedIds.push(value);
            return { error: null };
          },
        }),
      };
    }
    if (table === "audit_logs") {
      return {
        insert: async (row: any) => {
          state.audits.push(row);
          return { error: null };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  state.service = {
    from: state.from,
    rpc: vi.fn(),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          state.removed.push(...paths);
          return { error: null };
        },
      }),
    },
  };
});

describe("permanent ad deletion", () => {
  it("removes a live ad, its creative, and its verified money from the revenue total", async () => {
    const response = await POST(request("delete_ad"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deleted: true,
      slotId: 3,
      revenueExcludedCents: 9900,
      deletedBeforeExpiry: true,
    });

    // The banner file and the order row are both gone, so the slot is free.
    expect(state.removed).toEqual(["orders/banner.png"]);
    expect(state.deletedIds).toEqual(["88888888-8888-4888-8888-888888888888"]);

    // The audit trail keeps the reconciliation figures.
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "ad_order_deleted",
      target_type: "ad_order",
      target_id: "88888888-8888-4888-8888-888888888888",
      level: "warning",
      metadata: {
        slot_id: 3,
        previous_status: "live",
        payment_status: "verified",
        verified_cents: 9900,
        deleted_before_expiry: true,
      },
    });
  });

  it("deletes a rejected submission without taking money out of revenue", async () => {
    state.order = liveOrder({
      status: "rejected",
      payment_status: "unverified",
      ends_at: null,
      image_path: "",
    });
    const response = await POST(request("delete_ad"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, revenueExcludedCents: 0 });
    expect(state.removed).toEqual([]);
    expect(state.deletedIds).toHaveLength(1);
  });

  it("reports a missing advertisement instead of pretending it deleted one", async () => {
    state.order = null;
    const response = await POST(request("delete_ad"));
    expect(response.status).toBe(404);
    expect(state.deletedIds).toEqual([]);
  });
});
