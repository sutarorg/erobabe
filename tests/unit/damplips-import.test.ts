import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VIDEOS_PER_CATEGORY,
  importCategory,
  importCatalog,
  type ImportService,
} from "@/lib/damplips/importer";

/**
 * The importer writes through a Supabase service client. This fake implements
 * exactly the query shapes the importer uses, so the tests assert the catalog
 * rows that would be written without a database or the network.
 */

type Row = Record<string, any>;

function fakeService(seed: Row[] = []): ImportService & { rows: Row[]; inserts: number } {
  const rows: Row[] = [...seed];
  const state = { rows, inserts: 0 };

  function builder(resolve: () => { data: unknown; error: Row | null }) {
    const filters: Array<[string, unknown]> = [];
    const api: any = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return api;
      },
      limit: () => api,
      range: () => api,
      in: (column: string, values: unknown[]) => {
        filters.push([column, values]);
        return api;
      },
      maybeSingle: () => Promise.resolve(resolve()),
      insert: (row: Row) => {
        const duplicate = rows.some(
          (existing) =>
            existing.provider === row.provider &&
            existing.provider_file_id === row.provider_file_id,
        );
        if (duplicate) return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
        state.inserts += 1;
        rows.push({ id: `id-${rows.length + 1}`, ...row });
        return Promise.resolve({ error: null });
      },
      update: (patch: Row) => {
        const updateApi: any = {
          eq: (column: string, value: unknown) => {
            for (const row of rows) if (row[column] === value) Object.assign(row, patch);
            return Promise.resolve({ error: null });
          },
        };
        return updateApi;
      },
      then: (onFulfilled: (value: unknown) => unknown) => {
        const data = rows.filter((row) =>
          filters.every(([column, value]) => {
            if (Array.isArray(value)) return value.includes(row[column]);
            return row[column] === value;
          }),
        );
        return Promise.resolve({ data, error: null }).then(onFulfilled);
      },
    };
    return api;
  }

  return Object.assign(state, {
    from(table: string) {
      if (table !== "videos") throw new Error(`unexpected table ${table}`);
      return builder(() => ({ data: [], error: null }));
    },
  }) as unknown as ImportService & { rows: Row[]; inserts: number };
}

function card(id: number): string {
  return `
  <div class="video">
    <a href="https://www.damplips.com/p/${id}/" title="Video number ${id} with a long headline">
      <img src="https://video.damplips.com/pics/${id}.jpg" alt="">
    </a>
  </div>`;
}

function post(id: number, { media = true, poster = true } = {}): string {
  return `<!doctype html><html><head>
    <meta property="og:title" content="Video number ${id} with a long headline">
    <meta property="og:description" content="Description of video ${id}.">
    ${poster ? `<meta property="og:image" content="https://video.damplips.com/pics/${id}.jpg">` : ""}
    ${media ? `<meta property="og:video:url" content="https://video.damplips.com/videos/${id}.mp4">` : ""}
  </head><body><h1>Video number ${id} with a long headline</h1></body></html>`;
}

/** A listing that paginates, plus post pages for every id in it. */
function fakeFetch(options: {
  ids: number[];
  perPage: number;
  unusable?: Set<number>;
  noMedia?: Set<number>;
  noPoster?: Set<number>;
}) {
  const pages = new Map<string, string>();
  const totalPages = Math.max(1, Math.ceil(options.ids.length / options.perPage));
  for (let page = 1; page <= totalPages; page += 1) {
    const slice = options.ids.slice((page - 1) * options.perPage, page * options.perPage);
    const next =
      page < totalPages
        ? `<a rel="next" href="https://www.damplips.com/?s=hardcore&paged=${page + 1}">Next</a>`
        : "";
    const url =
      page === 1
        ? "https://www.damplips.com/?s=hardcore"
        : `https://www.damplips.com/?s=hardcore&paged=${page}`;
    pages.set(url, `${slice.map(card).join("")}${next}`);
  }

  const calls: string[] = [];
  const fetchPage = async (url: string) => {
    calls.push(url);
    if (pages.has(url)) {
      return { url, html: pages.get(url)!, status: 200 };
    }
    // The search fallback lists the same posts.
    if (/\/\?s=/.test(url)) {
      return { url, html: options.ids.map(card).join(""), status: 200 };
    }
    const match = /\/p\/(\d+)\//.exec(url);
    if (match) {
      const id = Number(match[1]);
      if (options.unusable?.has(id)) {
        return { url, html: "<html><body>nothing</body></html>", status: 200 };
      }
      return {
        url,
        html: post(id, {
          media: !options.noMedia?.has(id),
          poster: !options.noPoster?.has(id),
        }),
        status: 200,
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchPage, calls };
}

const CATEGORY_ID = "cat-hardcore";
const NOW = () => new Date("2026-10-27T00:00:00.000Z");

describe("damplips importer", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("ftyp", { status: 206, headers: { "content-type": "video/mp4" } }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("imports the requested number of videos with title, poster and media", async () => {
    const service = fakeService();
    const { fetchPage } = fakeFetch({ ids: [1, 2, 3, 4, 5, 6], perPage: 4 });
    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 5 },
      { fetchPage, service, categoryId: CATEGORY_ID, now: NOW, sleep: async () => {} },
    );

    expect(report.imported).toBe(5);
    expect(report.total).toBe(5);
    expect(report.fulfilled).toBe(true);
    expect(service.rows).toHaveLength(5);
    expect(service.rows[0]).toMatchObject({
      provider: "damplips",
      provider_file_id: "1",
      category_id: CATEGORY_ID,
      title: "Video number 1 with a long headline",
      thumbnail_url: "https://video.damplips.com/pics/1.jpg",
      playable_url: "https://video.damplips.com/videos/1.mp4",
      embed_url: null,
      source_name: "damplips",
      source_url: "https://www.damplips.com/p/1/",
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      moderation_status: "approved",
      requires_reupload: false,
      published_at: NOW().toISOString(),
    });
    expect(String(service.rows[0].slug)).toBe("video-number-1-with-a-long-headline-1");
  });

  it("pages through the listing until the quota is met", async () => {
    const service = fakeService();
    const { fetchPage, calls } = fakeFetch({ ids: [1, 2, 3, 4, 5, 6, 7], perPage: 3 });
    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 6 },
      { fetchPage, service, categoryId: CATEGORY_ID, sleep: async () => {} },
    );
    expect(report.imported).toBe(6);
    expect(calls.filter((url) => url.includes("s=hardcore"))).toHaveLength(2);
  });

  it("is idempotent: a second run adds nothing and reports what is already there", async () => {
    const service = fakeService();
    const fetch = fakeFetch({ ids: [1, 2, 3], perPage: 10 });
    await importCategory(
      { categorySlug: "hardcore", perCategory: 3 },
      { fetchPage: fetch.fetchPage, service, categoryId: CATEGORY_ID, sleep: async () => {} },
    );
    const second = await importCategory(
      { categorySlug: "hardcore", perCategory: 3 },
      { fetchPage: fetch.fetchPage, service, categoryId: CATEGORY_ID, sleep: async () => {} },
    );
    expect(service.rows).toHaveLength(3);
    expect(second.imported).toBe(0);
    expect(second.alreadyPresent).toBe(3);
    expect(second.total).toBe(3);
    expect(second.fulfilled).toBe(false);
  });

  it("skips posts with no thumbnail or no media and keeps filling the quota", async () => {
    const service = fakeService();
    const { fetchPage } = fakeFetch({
      ids: [1, 2, 3, 4, 5, 6],
      perPage: 6,
      noMedia: new Set([2]),
      unusable: new Set([3]),
    });
    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 4 },
      { fetchPage, service, categoryId: CATEGORY_ID, sleep: async () => {} },
    );
    expect(report.imported).toBe(4);
    expect(report.skipped.missingMedia).toBe(1);
    expect(report.skipped.failed).toBe(1);
    expect(service.rows.map((row) => row.provider_file_id)).toEqual(["1", "4", "5", "6"]);
  });

  it("counts a post once even when two categories list it", async () => {
    const service = fakeService();
    const { fetchPage } = fakeFetch({ ids: [1, 2, 3], perPage: 10 });
    const fetchBoth = async (url: string) => {
      if (url.includes("s=lesbian")) {
        return { url, html: [1, 2, 3].map(card).join(""), status: 200 };
      }
      return fetchPage(url);
    };
    const run = await importCatalog(
      {
        categories: [
          { slug: "hardcore", id: "cat-hardcore" },
          { slug: "lesbian", id: "cat-lesbian" },
        ],
        perCategory: 3,
      },
      { fetchPage: fetchBoth, service, sleep: async () => {} },
    );

    expect(run.categories[0].imported).toBe(3);
    expect(run.categories).toHaveLength(2);
    expect(run.categories[1].imported).toBe(0);
    expect(service.rows).toHaveLength(3);
  });

  it("writes nothing in a dry run and returns samples", async () => {
    const service = fakeService();
    const { fetchPage } = fakeFetch({ ids: [1, 2], perPage: 10 });
    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 2, dryRun: true },
      { fetchPage, service, categoryId: CATEGORY_ID, sleep: async () => {} },
    );
    expect(service.inserts).toBe(0);
    expect(report.imported).toBe(2);
    expect(report.samples).toHaveLength(2);
    expect(report.samples[0]).toMatchObject({
      title: "Video number 1 with a long headline",
      mediaKind: "direct",
      mediaUrl: "https://video.damplips.com/videos/1.mp4",
    });
  });

  it("stages private drafts when the rights are not cleared", async () => {
    const service = fakeService();
    const { fetchPage } = fakeFetch({ ids: [1], perPage: 10 });
    await importCategory(
      { categorySlug: "hardcore", perCategory: 1, rightsStatus: "pending" },
      { fetchPage, service, categoryId: CATEGORY_ID, sleep: async () => {} },
    );
    expect(service.rows[0]).toMatchObject({
      status: "pending_review",
      visibility: "private",
      rights_status: "pending",
      published_at: null,
    });
  });

  it("reports an unmet minimum instead of pretending the category is full", async () => {
    const service = fakeService();
    const { fetchPage } = fakeFetch({ ids: [1, 2, 3], perPage: 10 });
    const report = await importCategory(
      { categorySlug: "hardcore" },
      { fetchPage, service, categoryId: CATEGORY_ID, sleep: async () => {} },
    );
    expect(report.target).toBe(DEFAULT_VIDEOS_PER_CATEGORY);
    expect(report.imported).toBe(3);
    expect(report.total).toBe(3);
    expect(report.fulfilled).toBe(false);
  });

  it("records a listing failure and moves on to the next source", async () => {
    const service = fakeService();
    const { fetchPage } = fakeFetch({ ids: [1, 2], perPage: 10 });
    const fetchWithBrokenCategory = async (url: string) => {
      if (/[?&]s=hardcore(?:&|$)/.test(url) && !url.includes("paged")) throw new Error("damplips responded 503");
      return fetchPage(url);
    };
    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 2 },
      { fetchPage: fetchWithBrokenCategory, service, categoryId: CATEGORY_ID, sleep: async () => {} },
    );
    expect(report.sources[0].error).toContain("503");
    expect(report.imported).toBe(0);
  });

  it("refuses a category with no configured source", async () => {
    const service = fakeService();
    await expect(
      importCategory(
        { categorySlug: "not-a-category" },
        {
          fetchPage: async () => ({ url: "", html: "", status: 200 }),
          service,
          categoryId: "x",
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow(/No damplips source/);
  });
});
