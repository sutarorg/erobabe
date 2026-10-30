// @vitest-environment node
import { describe, expect, it } from "vitest";
import { categoryCounts, type ImportService } from "@/lib/damplips/importer";

/**
 * The panel's numbers are what an operator decides on ("this category already
 * has 110, skip it"), so they are checked here against a fake PostgREST that
 * behaves like the real one: filters, exact counts, and the 1 000-row page.
 */

type Row = Record<string, any>;

type FakeOptions = {
  categories?: Array<{ id: string; label: string; slug: string }>;
  videos: Row[];
  /** `false` simulates a client that answers without a `count`. */
  headCounts?: boolean;
  pageSize?: number;
};

const CATEGORIES = [
  { id: "cat-amateur", label: "Amateur", slug: "amateur" },
  { id: "cat-pov", label: "POV", slug: "pov" },
];

function damplipsVideo(categoryId: string, index: number, overrides: Row = {}): Row {
  return {
    id: `${categoryId}-${index}`,
    category_id: categoryId,
    provider: "damplips",
    status: "published",
    visibility: "public",
    rights_status: "cleared",
    moderation_status: "approved",
    requires_reupload: false,
    playable_url: `https://video.damplips.com/videos/${index}.mp4`,
    embed_url: null,
    ...overrides,
  };
}

function createService(options: FakeOptions) {
  const pageSize = options.pageSize ?? 1000;
  const headCounts = options.headCounts !== false;
  const categories = options.categories ?? CATEGORIES;
  const videos = options.videos;
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; head: boolean }> = [];

  function matches(row: Row, filters: Array<[string, unknown]>) {
    return filters.every(([column, value]) => row[column] === value);
  }

  function builder(table: string, head: boolean, initial: Array<[string, unknown]>) {
    const record = { table, filters: initial, head };
    queries.push(record);
    let paged = false;
    let from = 0;
    let to = Number.MAX_SAFE_INTEGER;

    const api: any = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        record.filters.push([column, value]);
        return api;
      },
      // The only `or` the counter issues: a row must have media of some kind.
      or: (expression: string) => {
        if (!expression.includes("playable_url.not.is.null")) throw new Error(`unexpected or(): ${expression}`);
        record.filters.push(["__has_media__", true]);
        return api;
      },
      order: () => api,
      range: (start: number, end: number) => {
        paged = true;
        from = start;
        to = end;
        return api;
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const rows =
          table === "categories"
            ? categories
            : videos.filter((row) =>
                record.filters.every(([column, value]) => {
                  if (column === "__has_media__") return Boolean(row.playable_url || row.embed_url);
                  return row[column] === value;
                }),
              );
        if (head) {
          return Promise.resolve({
            data: null,
            count: headCounts ? rows.length : null,
            error: null,
          }).then(resolve, reject);
        }
        const window = paged ? rows.slice(from, to + 1) : rows.slice(0, pageSize);
        return Promise.resolve({ data: window, count: null, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  const service = {
    from: (table: string) => {
      let filters: Array<[string, unknown]> = [];
      const api: any = {
        select: (_columns?: string, options?: { count?: string; head?: boolean }) =>
          builder(table, Boolean(options?.head), filters),
        // Categories are read with `.select(...).order(...)`; the chain starts
        // before any filter, so hand out a builder that collects them.
      };
      return new Proxy(api, {
        get: (target, property: string) => {
          if (property in target) return target[property as keyof typeof target];
          return (...args: unknown[]) => {
            filters = [...filters, [property, args[0]]];
            return target;
          };
        },
      });
    },
  } as unknown as ImportService;

  return { service, queries };
}

describe("per-category counts", () => {
  it("counts every video in the category, drafts included", async () => {
    const { service } = createService({
      videos: [
        damplipsVideo("cat-amateur", 1),
        damplipsVideo("cat-amateur", 2),
        // Staged for review: in the catalog, invisible to visitors.
        damplipsVideo("cat-amateur", 3, {
          status: "pending_review",
          visibility: "private",
          rights_status: "pending",
        }),
        damplipsVideo("cat-pov", 4),
      ],
    });

    const counts = await categoryCounts(service);
    expect(counts).toEqual([
      { id: "cat-amateur", slug: "amateur", label: "Amateur", published: 2, total: 3 },
      { id: "cat-pov", slug: "pov", label: "POV", published: 1, total: 1 },
    ]);
  });

  it("keeps counting past the 1 000-row page the old tally fell off", async () => {
    const videos = Array.from({ length: 1500 }, (_, index) => damplipsVideo("cat-amateur", index));
    const { service, queries } = createService({ videos });

    const [amateur] = await categoryCounts(service);
    expect(amateur.published).toBe(1500);
    expect(amateur.total).toBe(1500);
    // Every count came from the database, not from a page of rows.
    expect(queries.filter((query) => query.table === "videos")).toHaveLength(4);
    expect(queries.every((query) => query.table !== "videos" || query.head)).toBe(true);
  });

  it("only counts a video as live when a visitor could actually play it", async () => {
    const { service, queries } = createService({
      videos: [
        damplipsVideo("cat-pov", 1),
        damplipsVideo("cat-pov", 2, { status: "draft" }),
        damplipsVideo("cat-pov", 3, { visibility: "private" }),
        damplipsVideo("cat-pov", 4, { rights_status: "pending" }),
        damplipsVideo("cat-pov", 5, { moderation_status: "pending" }),
        damplipsVideo("cat-pov", 6, { requires_reupload: true }),
        damplipsVideo("cat-pov", 7, { playable_url: null, embed_url: null }),
        damplipsVideo("cat-pov", 8, { playable_url: null, embed_url: "https://www.damplips.com/embed/8" }),
      ],
    });

    const [, pov] = await categoryCounts(service);
    expect(pov.total).toBe(8);
    expect(pov.published).toBe(2);

    const liveQuery = queries.find(
      (query) =>
        query.table === "videos" &&
        query.filters.some(([column, value]) => column === "category_id" && value === "cat-pov") &&
        query.filters.some(([column]) => column === "status"),
    );
    expect(liveQuery?.filters).toEqual(
      expect.arrayContaining([
        ["provider", "damplips"],
        ["category_id", "cat-pov"],
        ["status", "published"],
        ["visibility", "public"],
        ["rights_status", "cleared"],
        ["moderation_status", "approved"],
        ["requires_reupload", false],
        ["__has_media__", true],
      ]),
    );
  });

  it("ignores rows from another provider", async () => {
    const { service } = createService({
      videos: [
        damplipsVideo("cat-amateur", 1),
        damplipsVideo("cat-amateur", 2, { provider: "legacy" }),
      ],
    });
    const [amateur] = await categoryCounts(service);
    expect(amateur).toMatchObject({ published: 1, total: 1 });
  });

  it("stays exact when the client answers without a count", async () => {
    const videos = Array.from({ length: 2500 }, (_, index) => damplipsVideo("cat-pov", index));
    const { service, queries } = createService({ videos, headCounts: false, pageSize: 1000 });

    const [amateur, pov] = await categoryCounts(service);
    expect(pov.published).toBe(2500);
    expect(pov.total).toBe(2500);
    expect(amateur.published).toBe(0);

    // Every paged read is a 1 000-row request: amateur needs one empty page per
    // counter, pov needs 1000 + 1000 + 500 for each of its two counters.
    const reads = queries.filter((query) => query.table === "videos" && !query.head);
    expect(reads).toHaveLength(2 + 6);
  });

  it("reports zero for a category with nothing in it", async () => {
    const { service } = createService({ categories: [...CATEGORIES, { id: "cat-empty", label: "Empty", slug: "empty" }], videos: [] });
    const counts = await categoryCounts(service);
    expect(counts.find((entry) => entry.slug === "empty")).toMatchObject({ published: 0, total: 0 });
  });

  it("surfaces an unreadable catalog instead of reporting zero", async () => {
    const broken = {
      from: (table: string) => ({
        select: () => ({
          order: async () => ({ data: null, error: { message: "relation categories does not exist" } }),
        }),
      }),
    } as unknown as ImportService;

    await expect(categoryCounts(broken)).rejects.toThrow("relation categories does not exist");
  });
});
