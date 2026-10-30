// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  releaseAdCreative,
  releaseFinishedCreatives,
  AD_CREATIVE_BUCKET,
} from "@/lib/ads/creative-cleanup";

type Row = Record<string, any>;

function fakeService(rows: Row[], options: { removeFails?: boolean; updateFails?: boolean } = {}) {
  const removed: string[] = [];
  const updates: Array<{ patch: Row; id: unknown }> = [];
  const filters: Array<Array<[string, string, unknown]>> = [];

  function builder(table: string) {
    const conditions: Array<[string, string, unknown]> = [];
    filters.push(conditions);
    let lim = Number.POSITIVE_INFINITY;
    const api: any = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        conditions.push(["eq", column, value]);
        return api;
      },
      in: (column: string, values: unknown[]) => {
        conditions.push(["in", column, values]);
        return api;
      },
      not: (column: string, operator: string, value: unknown) => {
        conditions.push(["not", column, `${operator}:${value}`]);
        return api;
      },
      lt: (column: string, value: unknown) => {
        conditions.push(["lt", column, value]);
        return api;
      },
      limit: (value: number) => {
        lim = value;
        return api;
      },
      update: (patch: Row) => {
        const target: any = {
          eq: (column: string, value: unknown) => {
            updates.push({ patch, id: value });
            return Promise.resolve({ error: options.updateFails ? { message: "denied" } : null });
          },
        };
        return target;
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const data =
          table === "ad_orders"
            ? rows
                .filter((row) =>
                  conditions.every(([kind, column, value]) => {
                    if (kind === "eq") return row[column] === value;
                    if (kind === "in") return (value as unknown[]).includes(row[column]);
                    if (kind === "not") return row[column] !== null && row[column] !== undefined;
                    if (kind === "lt") return String(row[column]) < String(value);
                    return true;
                  }),
                )
                .slice(0, lim)
            : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    removed,
    updates,
    filters,
    service: {
      from: builder,
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            if (bucket !== AD_CREATIVE_BUCKET) return { error: { message: "wrong bucket" } };
            if (options.removeFails) return { error: { message: "bucket unavailable" } };
            removed.push(...paths);
            return { error: null };
          },
        }),
      },
    } as any,
  };
}

const ORDER = {
  id: "77777777-7777-4777-8777-777777777777",
  image_path: "orders/banner.webp",
  image_url: "https://cdn.example.com/orders/banner.webp",
};

beforeEach(() => vi.clearAllMocks());

describe("releasing one creative", () => {
  it("deletes the file from the bucket and blanks the row's image columns", async () => {
    const { service, removed, updates } = fakeService([]);
    const result = await releaseAdCreative(service, ORDER);

    expect(removed).toEqual(["orders/banner.webp"]);
    expect(updates).toEqual([{ patch: { image_url: null, image_path: null }, id: ORDER.id }]);
    expect(result).toEqual({
      orderId: ORDER.id,
      path: "orders/banner.webp",
      removed: true,
      cleared: true,
    });
  });

  it("still clears the reference when the bucket refuses the delete", async () => {
    const { service, removed, updates } = fakeService([], { removeFails: true });
    const result = await releaseAdCreative(service, ORDER);

    expect(removed).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(result).toMatchObject({ removed: false, cleared: true });
  });

  it("reports a failed update instead of pretending it worked", async () => {
    const { service } = fakeService([], { updateFails: true });
    const result = await releaseAdCreative(service, ORDER);
    expect(result).toMatchObject({ removed: true, cleared: false });
  });

  it("does nothing to storage for a row that never had a file", async () => {
    const { service, removed, updates } = fakeService([]);
    const result = await releaseAdCreative(service, { id: "x", image_path: null, image_url: null });

    expect(removed).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(result).toMatchObject({ path: null, removed: true, cleared: true });
  });
});

describe("the periodic sweep", () => {
  const now = new Date("2026-10-30T09:00:00.000Z");

  function order(id: string, status: string, overrides: Row = {}) {
    return {
      id,
      status,
      image_path: `orders/${id}.webp`,
      image_url: `https://cdn.example.com/${id}.webp`,
      ends_at: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("removes rejected banners and banners whose paid window closed", async () => {
    const { service, removed } = fakeService([
      order("rejected-1", "rejected"),
      order("expired-1", "live"),
      // Still running: the query's cutoff excludes it, but check the guard too.
      order("running-1", "live", { ends_at: "2026-12-01T00:00:00.000Z" }),
      // In review, not rejected: untouched.
      order("review-1", "in_review"),
    ]);

    const released = await releaseFinishedCreatives(service, { now });
    const ids = released.map((entry) => entry.orderId).sort();
    expect(ids).toContain("rejected-1");
    expect(ids).not.toContain("review-1");
    expect(removed.some((path) => path.includes("rejected-1"))).toBe(true);
  });

  it("looks only at rows that still have a file, only the wanted states, with a bounded limit", async () => {
    const { service, filters } = fakeService([]);
    await releaseFinishedCreatives(service, { now, limit: 500 });

    const conditions = filters.flat();
    expect(conditions).toEqual(
      expect.arrayContaining([
        ["eq", "status", "rejected"],
        ["in", "status", ["live", "paused"]],
        ["lt", "ends_at", expect.any(String)],
      ]),
    );
    // Two days of grace so a cached page cannot land on a deleted banner.
    const cutoff = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    expect(conditions).toEqual(expect.arrayContaining([["lt", "ends_at", cutoff]]));
  });

  it("never releases the same order twice", async () => {
    const shared = order("both-1", "rejected");
    const { service, removed } = fakeService([shared, { ...shared, status: "live" }]);
    const released = await releaseFinishedCreatives(service, { now });
    expect(released.filter((entry) => entry.orderId === "both-1")).toHaveLength(1);
    expect(removed.filter((path) => path.includes("both-1"))).toHaveLength(1);
  });

  it("returns nothing when there is nothing to clean", async () => {
    const { service, removed } = fakeService([order("review-1", "in_review")]);
    await expect(releaseFinishedCreatives(service, { now })).resolves.toEqual([]);
    expect(removed).toEqual([]);
  });
});
