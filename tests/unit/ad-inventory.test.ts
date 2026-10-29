// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, { data: any; error: any }>,
  thrown: null as any,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => {
    if (state.thrown) throw state.thrown;
    return {
      from(table: string) {
        const result = state.tables[table] || { data: [], error: null };
        const builder: any = {};
        for (const method of ["select", "order", "in", "gt", "eq", "limit"]) {
          builder[method] = () => builder;
        }
        builder.then = (onFulfilled: any, onRejected: any) =>
          Promise.resolve(result).then(onFulfilled, onRejected);
        return builder;
      },
    };
  },
}));

import { loadInventory, slotBoardRows } from "@/lib/ads/inventory";

const slots = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  name: `Placement ${index + 1}`,
  side: index < 5 ? "left" : "right",
  position: (index % 5) + 1,
  price_cents: 9900,
  status: "available",
  description: null,
}));

const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  state.thrown = null;
  state.tables = {
    ad_slots: { data: slots, error: null },
    campaigns: {
      data: [
        {
          slot_id: 7,
          status: "active",
          end_date: future.slice(0, 10),
          name: "Historical campaign",
          creative: {
            image_url: "https://cdn.example.com/campaign.png",
            title: "Campaign creative",
            destination_url: "https://example.com/campaign",
          },
        },
        // An expired payment hold no longer occupies its placement.
        { slot_id: 8, status: "pending_payment", hold_expires_at: past, end_date: future.slice(0, 10) },
      ],
      error: null,
    },
    ad_orders: {
      data: [
        {
          slot_id: 3,
          status: "live",
          ends_at: future,
          ad_name: "Summer launch",
          image_url: "https://cdn.example.com/orders/live.png",
          destination_url: "https://example.com/offer",
        },
        {
          slot_id: 4,
          status: "in_review",
          ends_at: null,
          ad_name: "Awaiting review",
          image_url: "https://cdn.example.com/orders/review.png",
          destination_url: "https://example.com/review",
        },
        {
          slot_id: 5,
          status: "live",
          ends_at: past,
          ad_name: "Finished run",
          image_url: "https://cdn.example.com/orders/finished.png",
          destination_url: "https://example.com/finished",
        },
      ],
      error: null,
    },
  };
});

describe("ad slot occupancy", () => {
  it("marks live, in-review and campaign placements as taken and the rest as available", async () => {
    const inventory = await loadInventory();
    const byId = new Map(inventory.map((slot) => [slot.id, slot]));

    expect(byId.get(3)?.available).toBe(false);
    expect(byId.get(3)?.ad).toMatchObject({
      ad_name: "Summer launch",
      image_url: "https://cdn.example.com/orders/live.png",
      live: true,
      source: "order",
    });

    // In review still blocks the slot, but its creative is not public yet.
    expect(byId.get(4)?.available).toBe(false);
    expect(byId.get(4)?.ad?.live).toBe(false);

    // A campaign whose end date is in the past no longer blocks a sale.
    expect(byId.get(5)?.available).toBe(true);
    expect(byId.get(8)?.available).toBe(true);

    expect(byId.get(7)?.ad).toMatchObject({ ad_name: "Campaign creative", live: true });
    expect(byId.get(1)?.available).toBe(true);
    expect(inventory.filter((slot) => slot.available)).toHaveLength(7);
  });

  it("labels the dashboard board with Available and Taken", async () => {
    const board = slotBoardRows(await loadInventory());
    expect(board.find((slot) => slot.id === 3)?.label).toBe("Taken");
    expect(board.find((slot) => slot.id === 3)?.taken).toBe(true);
    expect(board.find((slot) => slot.id === 1)?.label).toBe("Available");
    expect(board.find((slot) => slot.id === 1)?.taken).toBe(false);
  });

  it("refuses to sell anything when the slot table cannot be read", async () => {
    state.tables.ad_slots = { data: null, error: { code: "08006", message: "connection failure" } };
    await expect(loadInventory()).rejects.toThrow("Unable to load inventory");
  });
});
