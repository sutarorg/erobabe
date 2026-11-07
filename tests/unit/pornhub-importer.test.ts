// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_PAGES_PER_REQUEST,
  importCategorySlice,
  type PornhubImportDeps,
} from "@/lib/pornhub/importer";
import { searchUrl } from "@/lib/pornhub/parse";
import type { FetchPornhubPage } from "@/lib/pornhub/client";

/**
 * The importer is what stands between a search page and the live catalog, so
 * these tests exercise the whole loop against a fake Pornhub and a fake
 * Supabase:
 *
 *  - only HD videos are written, and they are written as embeds with posters;
 *  - nothing is ever written twice, whether it is already in the database or
 *    appears on two pages of the same run;
 *  - the cursor resumes exactly where the previous slice stopped, so an
 *    unlimited run is just "call again while `exhausted` is false".
 */

type Row = Record<string, unknown>;

function card(options: {
  viewkey: string;
  title: string;
  thumb?: string;
  hd?: boolean;
  duration?: string;
}): string {
  const thumb = options.thumb ?? `https://ei.phncdn.com/videos/${options.viewkey}_1.jpg`;
  return `<li class="pcVideoListItem" data-video-vkey="${options.viewkey}" data-thumb_url="${thumb}" data-title="${options.title}" data-duration="${options.duration ?? "12:34"}">
    <a href="/view_video.php?viewkey=${options.viewkey}" title="${options.title}">
      <img src="${thumb}" alt="${options.title}" />
    </a>
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

/** A fake PostgREST client: `in` reads, `insert` writes, conflicts are 23505. */
function createService(seed: string[] = [], options: { failBatchOnce?: boolean } = {}) {
  const rows = new Map<string, Row>();
  for (const viewkey of seed) rows.set(viewkey, { provider: "pornhub", provider_file_id: viewkey });
  const inserted: Row[] = [];
  let batchFailures = options.failBatchOnce ? 1 : 0;
  const queries: string[] = [];

  const service = {
    from(table: string) {
      if (table !== "videos") throw new Error(`unexpected table ${table}`);
      return {
        select: (columns: string) => {
          queries.push(`select ${columns}`);
          return {
            eq: () => ({
              in: async (_column: string, values: string[]) => ({
                data: values
                  .filter((value) => rows.has(value))
                  .map((value) => ({ provider_file_id: value })),
                error: null,
              }),
            }),
          };
        },
        insert: async (input: Row | Row[]) => {
          const batch = Array.isArray(input) ? input : [input];
          queries.push(`insert ${batch.length}`);
          if (batchFailures > 0 && batch.length > 1) {
            batchFailures -= 1;
            return { error: { code: "23505", message: "duplicate key value" } };
          }
          const clash = batch.find((row) => rows.has(String(row.provider_file_id)));
          if (clash) return { error: { code: "23505", message: "duplicate key value" } };
          for (const row of batch) {
            rows.set(String(row.provider_file_id), row);
            inserted.push(row);
          }
          return { error: null };
        },
      };
    },
  };

  return { service, inserted, queries, rows };
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

const AMATEUR_1 = searchUrl("amateur", 1);
const AMATEUR_2 = searchUrl("amateur", 2);
const AMATEUR_AMATEUR_1 = searchUrl("homemade amateur", 1);

describe("Pornhub import", () => {
  it("writes HD videos as embeds, with poster, duration and quality", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_1]: listingHtml([
        card({ viewkey: "key000000001", title: "Morning coffee", hd: true, duration: "12:34" }),
        card({ viewkey: "key000000002", title: "Slow afternoon", hd: true, duration: "21:10" }),
      ]),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur" },
      deps(fetchPage, service),
    );

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

  it("skips videos the listing does not mark HD", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_1]: listingHtml([
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
      [AMATEUR_1]: listingHtml([
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
      [AMATEUR_1]: listingHtml([
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
      [AMATEUR_1]: listingHtml([
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
      [AMATEUR_1]: listingHtml([
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
      [AMATEUR_1]: listingHtml([card({ viewkey: "key000000001", title: "Page one", hd: true })], 5),
      [AMATEUR_2]: listingHtml([card({ viewkey: "key000000002", title: "Page two", hd: true })], 5),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: 1 },
      deps(fetchPage, service),
    );

    expect(fetched).toEqual([AMATEUR_1]);
    expect(report.pagesRead).toBe(1);
    expect(report.imported).toBe(1);
    expect(report.exhausted).toBe(false);
    expect(report.cursor).toEqual({ source: 0, page: 2 });
  });

  it("continues from the cursor the previous slice returned", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [AMATEUR_1]: listingHtml([card({ viewkey: "key000000001", title: "Page one", hd: true })], 5),
      [AMATEUR_2]: listingHtml([card({ viewkey: "key000000002", title: "Page two", hd: true })], 5),
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

  it("picks up the second search phrase when the first runs dry", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({
      // "amateur" is exhausted: no cards, so the next phrase is tried at once.
      [AMATEUR_1]: listingHtml([]),
      [AMATEUR_AMATEUR_1]: listingHtml([
        card({ viewkey: "key000000003", title: "Homemade and new", hd: true }),
      ]),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    // The empty first phrase is walked, then the second one is read page by page.
    expect(fetched.slice(0, 2)).toEqual([AMATEUR_1, AMATEUR_AMATEUR_1]);
    expect(report.imported).toBe(1);
    expect(report.exhausted).toBe(true);
  });

  it("reports the search as exhausted once every phrase has been walked", async () => {
    const { service } = createService();
    const { fetchPage } = createFetcher({});

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.exhausted).toBe(true);
    expect(report.imported).toBe(0);
    expect(report.pagesRead).toBe(2); // both phrases, each one empty page
  });

  it("does not cap a run at a fixed number of videos", async () => {
    const { service, inserted } = createService();
    const pages: Record<string, string> = {};
    // Five pages of twenty videos: an import has no reason to stop at 10 or 50.
    for (let page = 1; page <= 5; page += 1) {
      pages[searchUrl("amateur", page)] = listingHtml(
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
      [AMATEUR_1]: listingHtml([
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
      [AMATEUR_1]: listingHtml([card({ viewkey: "key000000001", title: "Needs review", hd: true })]),
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
      if (url === AMATEUR_1) throw new Error("Pornhub responded 503");
      return {
        url,
        html: listingHtml([card({ viewkey: "key000000009", title: "From the second phrase", hd: true })]),
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
});
