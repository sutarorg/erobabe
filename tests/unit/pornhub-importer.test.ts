// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_PAGES_BEFORE_NEXT_SOURCE,
  MAX_DETAIL_FETCHES_PER_REQUEST,
  MAX_PAGES_PER_REQUEST,
  importCategorySlice,
  looksLikePoster,
  repairThumbnails,
  type PornhubImportDeps,
} from "@/lib/pornhub/importer";
import { PORNHUB_BASE_URL, searchUrl } from "@/lib/pornhub/parse";
import { searchPlan } from "@/lib/pornhub/categories";
import type { FetchPornhubPage } from "@/lib/pornhub/client";

/**
 * The importer is what stands between a search page and the live catalog, so
 * these tests exercise the whole loop against a fake Pornhub and a fake
 * Supabase:
 *
 *  - only HD videos are written, and they are written as embeds with posters;
 *  - nothing is ever written twice, whether it is already in the database or
 *    appears on two pages of the same run;
 *  - the popular searches are walked first, and the videos of one page are
 *    written in view order;
 *  - the cursor resumes exactly where the previous slice stopped, so an
 *    unlimited run is just "call again while `exhausted` is false".
 */

type Row = Record<string, unknown>;

function card(options: {
  viewkey: string;
  title: string;
  thumb?: string | null;
  hd?: boolean;
  duration?: string;
  views?: string;
}): string {
  const thumb = options.thumb === null ? null : (options.thumb ?? `https://ei.phncdn.com/videos/${options.viewkey}_1.jpg`);
  return `<li class="pcVideoListItem" data-video-vkey="${options.viewkey}"${
    thumb ? ` data-thumb_url="${thumb}"` : ""
  } data-title="${options.title}" data-duration="${options.duration ?? "12:34"}">
    <a href="/view_video.php?viewkey=${options.viewkey}" title="${options.title}">
      ${thumb ? `<img src="${thumb}" alt="${options.title}" />` : ""}
    </a>
    ${options.views ? `<span class="views"><var>${options.views}</var> views</span>` : ""}
    ${options.hd ? '<var class="hd-thumbnail">HD</var>' : ""}
  </li>`;
}

function listingHtml(cards: string[], totalPages?: number): string {
  return `<html><body><ul>${cards.join("\n")}</ul>${
    totalPages
      ? `<div class="pagination"><a href="/video/search?search=x&page=${totalPages}">${totalPages}</a></div>`
      : ""
  }</body></html>`;
}

/** A fake PostgREST client: filters, reads, inserts and updates over one table. */
function createService(seed: string[] = [], options: { failBatchOnce?: boolean } = {}) {
  const rows = new Map<string, Row>();
  let nextId = 1;
  for (const viewkey of seed) {
    rows.set(`row-${nextId}`, { id: `row-${nextId}`, provider: "pornhub", provider_file_id: viewkey });
    nextId += 1;
  }
  const inserted: Row[] = [];
  const updates: Array<{ id: unknown; patch: Row }> = [];
  let batchFailures = options.failBatchOnce ? 1 : 0;
  const queries: string[] = [];

  type Filter = { column: string; op: string; value: unknown };

  function selectQuery(columns: string) {
    queries.push(`select ${columns}`);
    const filters: Filter[] = [];
    let limit: number | null = null;

    const run = () => {
      let matched = [...rows.values()].filter((row) =>
        filters.every((filter) => {
          const value = row[filter.column];
          if (filter.op === "eq") return value === filter.value;
          if (filter.op === "in") return (filter.value as unknown[]).includes(value);
          if (filter.op === "is") return filter.value === null ? value == null : value === filter.value;
          if (filter.op === "not-is") return value != null;
          return true;
        }),
      );
      if (limit != null) matched = matched.slice(0, limit);
      return { data: matched, error: null };
    };

    const builder: Record<string, unknown> = {
      eq: (column: string, value: unknown) => {
        filters.push({ column, op: "eq", value });
        return builder;
      },
      in: (column: string, value: unknown[]) => {
        filters.push({ column, op: "in", value });
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push({ column, op: "is", value });
        return builder;
      },
      not: (column: string, _operator: string, value: unknown) => {
        filters.push({ column, op: value === null ? "not-is" : "not-eq", value });
        return builder;
      },
      order: () => builder,
      limit: (value: number) => {
        limit = value;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  }

  const service = {
    from(table: string) {
      if (table !== "videos") throw new Error(`unexpected table ${table}`);
      return {
        select: (columns: string) => selectQuery(columns),
        insert: async (input: Row | Row[]) => {
          const batch = Array.isArray(input) ? input : [input];
          queries.push(`insert ${batch.length}`);
          if (batchFailures > 0 && batch.length > 1) {
            batchFailures -= 1;
            return { error: { code: "23505", message: "duplicate key value" } };
          }
          const clash = batch.find((row) =>
            [...rows.values()].some(
              (existing) => existing.provider_file_id === row.provider_file_id,
            ),
          );
          if (clash) return { error: { code: "23505", message: "duplicate key value" } };
          for (const row of batch) {
            const id = `row-${nextId}`;
            nextId += 1;
            rows.set(id, { ...row, id });
            inserted.push(row);
          }
          return { error: null };
        },
        update: (patch: Row) => ({
          eq: async (column: string, value: unknown) => {
            updates.push({ id: value, patch });
            for (const [id, row] of rows) {
              if (row[column] === value) rows.set(id, { ...row, ...patch });
            }
            return { error: null };
          },
        }),
      };
    },
  };

  return { service, inserted, updates, queries, rows };
}

/** A fake Pornhub: URL → HTML. Unknown pages are empty result pages. */
function createFetcher(pages: Record<string, string>) {
  const fetched: string[] = [];
  const fetchPage: FetchPornhubPage = async (url) => {
    fetched.push(url);
    return { url, html: pages[url] ?? listingHtml([]), status: 200 };
  };
  return { fetchPage, fetched };
}

function deps(fetchPage: FetchPornhubPage, service: unknown): PornhubImportDeps {
  return {
    fetchPage,
    service: service as PornhubImportDeps["service"],
    categoryId: "cat-amateur",
    delayMs: 0,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  };
}

/** One page of one search of the "amateur" plan. */
function planUrl(phrase: string, page = 1, order = "mv"): string {
  return searchUrl(phrase, page, PORNHUB_BASE_URL, order);
}

const AMATEUR_POPULAR_1 = planUrl("amateur", 1);
const AMATEUR_POPULAR_2 = planUrl("amateur", 2);
const HOMEMADE_POPULAR_1 = planUrl("amateur homemade", 1);

describe("Pornhub import", () => {
  it("writes HD videos as embeds, with poster, duration and quality", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "Morning coffee", hd: true, duration: "12:34" }),
        card({ viewkey: "key000000002", title: "Slow afternoon", hd: true, duration: "21:10" }),
      ]),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(report.imported).toBe(2);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      title: "Morning coffee",
      provider: "pornhub",
      provider_file_id: "key000000001",
      embed_url: "https://www.pornhub.com/embed/key000000001",
      playable_url: null,
      thumbnail_url: "https://ei.phncdn.com/videos/key000000001_1.jpg",
      duration_seconds: 754,
      quality: "HD",
      source_name: "pornhub",
      source_url: "https://www.pornhub.com/view_video.php?viewkey=key000000001",
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      published_at: "2026-01-02T03:04:05.000Z",
    });
    expect(inserted[1].duration_seconds).toBe(1270);
  });

  it("searches the popular orders before any other ordering", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml(
        [card({ viewkey: "key000000001", title: "Popular one", hd: true })],
        1,
      ),
    });

    await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    // The first request sorts by most viewed, and the whole popular pass runs
    // before Pornhub's own relevance order is ever asked for.
    expect(fetched[0]).toContain("o=mv");
    const firstTopRated = fetched.findIndex((url) => url.includes("o=tr"));
    const firstRelevance = fetched.findIndex((url) => !url.includes("o=mv") && !url.includes("o=tr") && !url.includes("o=cm"));
    if (firstTopRated >= 0 && firstRelevance >= 0) expect(firstTopRated).toBeLessThan(firstRelevance);
  });

  it("writes the most viewed videos of a page first and stores their view count", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "Quiet clip", hd: true, views: "12K" }),
        card({ viewkey: "key000000002", title: "Blockbuster", hd: true, views: "2.4M" }),
        card({ viewkey: "key000000003", title: "Steady hit", hd: true, views: "480K" }),
      ]),
    });

    await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(inserted.map((row) => row.title)).toEqual(["Blockbuster", "Steady hit", "Quiet clip"]);
    expect(inserted.map((row) => row.view_count)).toEqual([2_400_000, 480_000, 12_000]);
  });

  it("resolves a poster from the watch page instead of storing a blank card", async () => {
    const { service, inserted } = createService();
    const { fetchPage, fetched } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "Listing has no picture", hd: true, thumb: null }),
      ]),
      "https://www.pornhub.com/view_video.php?viewkey=key000000001": `<html><head>
          <meta property="og:title" content="Listing has no picture" />
          <meta property="og:image" content="https://ei.phncdn.com/videos/og-key1.jpg" />
        </head><body></body></html>`,
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(report.imported).toBe(1);
    expect(inserted[0].thumbnail_url).toBe("https://ei.phncdn.com/videos/og-key1.jpg");
    expect(fetched).toContain("https://www.pornhub.com/view_video.php?viewkey=key000000001");
  });

  it("still refuses a card that has no poster anywhere", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "No picture anywhere", hd: true, thumb: null }),
      ]),
      "https://www.pornhub.com/view_video.php?viewkey=key000000001": `<html><head>
          <meta property="og:title" content="No picture anywhere" />
        </head><body></body></html>`,
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.imported).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(report.skipped.noThumbnail).toBe(1);
  });

  it("does not spend an unbounded number of watch-page reads on one slice", async () => {
    const { service } = createService();
    const many = Array.from({ length: MAX_DETAIL_FETCHES_PER_REQUEST + 10 }, (_, index) =>
      card({
        viewkey: `key${String(index).padStart(10, "0")}`,
        title: `No poster ${index}`,
        hd: true,
        thumb: null,
      }),
    );
    const { fetchPage, fetched } = createFetcher({ [AMATEUR_POPULAR_1]: listingHtml(many) });

    await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    const watchReads = fetched.filter((url) => url.includes("view_video.php"));
    expect(watchReads.length).toBeLessThanOrEqual(MAX_DETAIL_FETCHES_PER_REQUEST);
  });

  it("skips videos the listing does not mark HD", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "Crisp and sharp", hd: true }),
        card({ viewkey: "key000000002", title: "Blurry webcam clip", hd: false }),
      ]),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.imported).toBe(1);
    expect(inserted.map((row) => row.title)).toEqual(["Crisp and sharp"]);
    expect(report.skipped.notHd).toBe(1);
  });

  it("checks the watch page when a listing carries no HD badge at all", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "Full HD upload" }),
        card({ viewkey: "key000000002", title: "Low resolution upload" }),
      ]),
      "https://www.pornhub.com/view_video.php?viewkey=key000000001": `<html><head>
          <meta property="og:title" content="Full HD upload" />
        </head><body><script>var f={"quality":[{"quality":"720"},{"quality":"1080"}]};</script></body></html>`,
      "https://www.pornhub.com/view_video.php?viewkey=key000000002": `<html><head>
          <meta property="og:title" content="Low resolution upload" />
        </head><body><script>var f={"quality":[{"quality":"360"}]};</script></body></html>`,
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.imported).toBe(1);
    expect(inserted[0]).toMatchObject({ quality: "HD", resolution: "1080p" });
    expect(report.skipped.notHd).toBe(1);
  });

  it("skips teasers shorter than a minute", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "A full scene", hd: true, duration: "18:00" }),
        card({ viewkey: "key000000002", title: "A thirteen second teaser", hd: true, duration: "00:13" }),
      ]),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.imported).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(report.skipped.short).toBe(1);
  });

  it("never writes a video that is already in the catalog", async () => {
    const { service, inserted } = createService(["key000000001"]);
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "Already imported", hd: true }),
        card({ viewkey: "key000000002", title: "Brand new", hd: true }),
      ]),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.imported).toBe(1);
    expect(report.duplicates).toBe(1);
    expect(inserted.map((row) => row.provider_file_id)).toEqual(["key000000002"]);
  });

  it("counts a race between two runs as a duplicate instead of failing", async () => {
    const { service, inserted } = createService([], { failBatchOnce: true });
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "First", hd: true }),
        card({ viewkey: "key000000002", title: "Second", hd: true }),
      ]),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    // The batch collided, so each row was retried on its own and both landed.
    expect(report.imported).toBe(2);
    expect(inserted).toHaveLength(2);
  });

  it("stops at the requested number of pages and hands back a cursor", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([card({ viewkey: "key000000001", title: "Page one", hd: true })], 5),
      [AMATEUR_POPULAR_2]: listingHtml([card({ viewkey: "key000000002", title: "Page two", hd: true })], 5),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: 1 },
      deps(fetchPage, service),
    );

    expect(fetched).toEqual([AMATEUR_POPULAR_1]);
    expect(report.pagesRead).toBe(1);
    expect(report.imported).toBe(1);
    expect(report.exhausted).toBe(false);
    expect(report.cursor).toEqual({ source: 0, page: 2 });
  });

  it("continues from the cursor the previous slice returned", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([card({ viewkey: "key000000001", title: "Page one", hd: true })], 5),
      [AMATEUR_POPULAR_2]: listingHtml([card({ viewkey: "key000000002", title: "Page two", hd: true })], 5),
    });

    const first = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: 1 },
      deps(fetchPage, service),
    );
    const second = await importCategorySlice(
      { categorySlug: "amateur", cursor: first.cursor, pagesPerRequest: 1 },
      deps(fetchPage, service),
    );

    expect(second.imported).toBe(1);
    expect(inserted.map((row) => row.provider_file_id)).toEqual([
      "key000000001",
      "key000000002",
    ]);
  });

  it("picks up the next search when the first runs dry", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({
      // "amateur" by most viewed is exhausted: no cards, so the next search is
      // tried at once.
      [AMATEUR_POPULAR_1]: listingHtml([]),
      [HOMEMADE_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000003", title: "Homemade and new", hd: true }),
      ]),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(fetched.slice(0, 2)).toEqual([AMATEUR_POPULAR_1, HOMEMADE_POPULAR_1]);
    expect(report.imported).toBe(1);
  });

  it("walks every search of the plan before reporting exhaustion", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({});
    const planLength = searchPlan("amateur").length;

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );
    expect(report.exhausted).toBe(true);
    expect(report.imported).toBe(0);
    expect(fetched).toHaveLength(planLength);
    // Every sort order is represented, most viewed first.
    expect(fetched[0]).toContain("o=mv");
    expect(fetched.some((url) => url.includes("o=tr"))).toBe(true);
    expect(fetched.some((url) => url.includes("o=cm"))).toBe(true);
    expect(fetched.at(-1)).not.toContain("o=");
  });

  it("moves on after a run of duplicate-only pages", async () => {
    const { service } = createService(["key000000001"]);
    const pages: Record<string, string> = {};
    for (let page = 1; page <= DUPLICATE_PAGES_BEFORE_NEXT_SOURCE + 2; page += 1) {
      pages[planUrl("amateur", page)] = listingHtml(
        [card({ viewkey: "key000000001", title: "Same video again", hd: true })],
        500,
      );
    }
    const { fetchPage, fetched } = createFetcher(pages);

    await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );

    // The popular "amateur" search stops after the duplicate cap and the next
    // search of the plan is asked for.
    expect(fetched).toContain(HOMEMADE_POPULAR_1);
  });

  it("does not cap a run at a fixed number of videos", async () => {
    const { service, inserted } = createService();
    const pages: Record<string, string> = {};
    // Five pages of twenty videos: an import has no reason to stop at 10 or 50.
    for (let page = 1; page <= 5; page += 1) {
      pages[planUrl("amateur", page)] = listingHtml(
        Array.from({ length: 20 }, (_, index) =>
          card({
            viewkey: `key${String(page)}${String(index).padStart(8, "0")}`,
            title: `Video ${page}-${index}`,
            hd: true,
          }),
        ),
        5,
      );
    }
    const { fetchPage } = createFetcher(pages);

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );

    expect(report.imported).toBe(100);
    expect(inserted).toHaveLength(100);
  });

  it("clamps an absurd page budget instead of trusting the caller", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({});
    await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: 10_000 },
      deps(fetchPage, service),
    );
    expect(fetched.length).toBeLessThanOrEqual(MAX_PAGES_PER_REQUEST);
  });

  it("writes nothing in a dry run but still reports what it would import", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "Would be imported", hd: true }),
      ]),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", dryRun: true },
      deps(fetchPage, service),
    );

    expect(report.imported).toBe(1);
    expect(report.dryRun).toBe(true);
    expect(inserted).toHaveLength(0);
    expect(report.samples[0]).toMatchObject({
      viewkey: "key000000001",
      embedUrl: "https://www.pornhub.com/embed/key000000001",
    });
  });

  it("stages drafts as private rows when rights are pending", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_POPULAR_1]: listingHtml([card({ viewkey: "key000000001", title: "Needs review", hd: true })]),
    });

    await importCategorySlice(
      { categorySlug: "amateur", rightsStatus: "pending" },
      deps(fetchPage, service),
    );

    expect(inserted[0]).toMatchObject({
      status: "pending_review",
      visibility: "private",
      rights_status: "pending",
      published_at: null,
    });
  });

  it("records an unreadable search page and moves on instead of stalling", async () => {
    const { service } = createService();
    const fetchPage: FetchPornhubPage = async (url) => {
      if (url === AMATEUR_POPULAR_1) throw new Error("Pornhub responded 503");
      return {
        url,
        html: listingHtml([card({ viewkey: "key000000009", title: "From the second search", hd: true })]),
        status: 200,
      };
    };

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.errors[0]).toContain("503");
    expect(report.imported).toBe(1);
  });

  it("refuses a category that has no configured source", async () => {
    const { service } = createService();
    const { fetchPage } = createFetcher({});
    await expect(
      importCategorySlice({ categorySlug: "not-a-category" }, deps(fetchPage, service)),
    ).rejects.toThrow(/No Pornhub source/);
  });

  it("fixes stored rows whose poster is missing or is not an image", async () => {
    const { service, rows, updates } = createService();
    rows.set("row-keep", {
      id: "row-keep",
      provider: "pornhub",
      provider_file_id: "keygood00001",
      thumbnail_url: "https://ei.phncdn.com/videos/good.jpg",
    });
    rows.set("row-null", {
      id: "row-null",
      provider: "pornhub",
      provider_file_id: "keynull00001",
      thumbnail_url: null,
    });
    rows.set("row-page", {
      id: "row-page",
      provider: "pornhub",
      provider_file_id: "keypage00001",
      thumbnail_url: "https://www.pornhub.com/view_video.php?viewkey=keypage00001",
    });
    rows.set("row-legacy", {
      id: "row-legacy",
      provider: "damplips",
      provider_file_id: "12345",
      thumbnail_url: null,
    });

    const { fetchPage, fetched } = createFetcher({
      "https://www.pornhub.com/view_video.php?viewkey=keynull00001": `<html><head>
          <meta property="og:title" content="Repaired null poster" />
          <meta property="og:image" content="https://ei.phncdn.com/videos/null.jpg" />
        </head></html>`,
      "https://www.pornhub.com/view_video.php?viewkey=keypage00001": `<html><head>
          <meta property="og:title" content="Repaired page poster" />
          <meta property="og:image" content="https://ei.phncdn.com/videos/page.jpg" />
        </head></html>`,
    });

    const result = await repairThumbnails({ service, fetchPage, delayMs: 0 });

    expect(result.repaired).toBe(2);
    expect(updates.map((update) => update.id).sort()).toEqual(["row-null", "row-page"]);
    expect(rows.get("row-null")?.thumbnail_url).toBe("https://ei.phncdn.com/videos/null.jpg");
    expect(rows.get("row-page")?.thumbnail_url).toBe("https://ei.phncdn.com/videos/page.jpg");
    // A healthy row is never re-read, and another provider is never touched.
    expect(fetched.join(" ")).not.toContain("keygood00001");
    expect(fetched.join(" ")).not.toContain("viewkey=12345");
  });

  it("reports how many stored posters a slice repaired", async () => {
    const { service, rows } = createService();
    rows.set("row-null", {
      id: "row-null",
      provider: "pornhub",
      provider_file_id: "keynull00001",
      thumbnail_url: null,
    });
    const { fetchPage } = createFetcher({
      "https://www.pornhub.com/view_video.php?viewkey=keynull00001": `<html><head>
          <meta property="og:title" content="Repaired null poster" />
          <meta property="og:image" content="https://ei.phncdn.com/videos/null.jpg" />
        </head></html>`,
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", repair: true },
      deps(fetchPage, service),
    );
    expect(report.repaired).toBe(1);
  });

  it("recognises a displayable poster URL", () => {
    expect(looksLikePoster("https://ei.phncdn.com/videos/x_1.jpg")).toBe(true);
    expect(looksLikePoster("https://www.pornhub.com/view_video.php?viewkey=abc12345")).toBe(false);
    expect(looksLikePoster("https://evil.example/x.jpg")).toBe(false);
    expect(looksLikePoster(null)).toBe(false);
    expect(looksLikePoster("data:image/gif;base64,R0lGOD")).toBe(false);
  });
});
