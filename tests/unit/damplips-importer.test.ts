// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DAMPLIPS_PROVIDER,
  MAX_PAGES_PER_REQUEST,
  importCategorySlice,
  looksLikePoster,
  repairThumbnails,
  type DamplipsImportDeps,
} from "@/lib/damplips/importer";
import { searchUrl, sourcePlan } from "@/lib/damplips/categories";
import type { FetchDamplipsPage } from "@/lib/damplips/client";

/**
 * The importer is what stands between a damplips listing and the live catalog,
 * so these tests drive the whole slice against a fixture site and an in-memory
 * catalog:
 *
 *  - a post is imported only with a poster and a playable file;
 *  - nothing is written twice, whether it is already in the database or appears
 *    on two listings of the same run;
 *  - the popular feeds are walked before the taxonomy and the searches;
 *  - the cursor resumes exactly where the previous slice stopped, so an
 *    unlimited run is just "call again until the operator presses Stop".
 */

type Row = Record<string, unknown>;

const BASE = "https://www.damplips.com";

function listingHtml(
  posts: Array<{ id: string; title?: string; poster?: string | null }>,
  next?: string,
): string {
  const anchors = posts
    .map((post) => {
      const poster =
        post.poster === null
          ? ""
          : `<img src="${post.poster ?? `https://video.damplips.com/pics/${post.id}.jpg`}" alt="" />`;
      return `<div class="post"><a href="/p/${post.id}/" title="${post.title ?? `Post ${post.id}`}">${poster}</a></div>`;
    })
    .join("\n");
  return `<html><body>${anchors}${next ? `<a class="next" rel="next" href="${next}">Next</a>` : ""}</body></html>`;
}

function postHtml(options: {
  title: string;
  poster?: string | null;
  duration?: string;
  media?: string | null;
  views?: string;
}): string {
  const poster =
    options.poster === null
      ? ""
      : `<meta property="og:image" content="${options.poster ?? "https://video.damplips.com/pics/og.jpg"}" />`;
  const media =
    options.media === null
      ? ""
      : `<meta property="og:video" content="${options.media ?? "https://video.damplips.com/video7/1/2.mp4"}" />`;
  return `<html><head>
    <meta property="og:title" content="${options.title}" />
    ${poster}
    ${media}
    <meta property="video:duration" content="${options.duration ?? "754"}" />
  </head><body><span class="views">${options.views ?? "1200"} views</span></body></html>`;
}

/** A fake PostgREST client: filters, reads, inserts and updates over one table. */
function createService(seed: string[] = []) {
  const rows = new Map<string, Row>();
  let nextId = 1;
  for (const postId of seed) {
    rows.set(`row-${nextId}`, {
      id: `row-${nextId}`,
      provider: DAMPLIPS_PROVIDER,
      provider_file_id: postId,
    });
    nextId += 1;
  }
  const inserted: Row[] = [];
  const updates: Array<{ id: unknown; patch: Row }> = [];

  type Filter = { column: string; op: string; value: unknown };

  function selectQuery() {
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
      range: () => builder,
      maybeSingle: async () => run(),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  }

  const service = {
    from(table: string) {
      if (table !== "videos") throw new Error(`unexpected table ${table}`);
      return {
        select: () => selectQuery(),
        insert: async (input: Row | Row[]) => {
          const batch = Array.isArray(input) ? input : [input];
          const clash = batch.find((row) =>
            [...rows.values()].some((existing) => existing.provider_file_id === row.provider_file_id),
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

  return { service, inserted, updates, rows };
}

/** A fake damplips: URL → HTML. Unknown pages are empty listings. */
function createFetcher(pages: Record<string, string>) {
  const fetched: string[] = [];
  const fetchPage: FetchDamplipsPage = async (url) => {
    fetched.push(url);
    return { url, html: pages[url] ?? listingHtml([]), status: 200 };
  };
  return { fetchPage, fetched };
}

function deps(fetchPage: FetchDamplipsPage, service: unknown): DamplipsImportDeps {
  return {
    fetchPage,
    service: service as DamplipsImportDeps["service"],
    categoryId: "cat-amateur",
    delayMs: 0,
    fetchHostMedia: async (url) => url,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  };
}

const POPULAR = `${BASE}/most-popular/`;
const POPULAR_ALT = `${BASE}/popular/`;
const TAXONOMY = `${BASE}/c/amateur-porn/`;
const SEARCH = `${BASE}/?s=amateur`;

describe("damplips import", () => {
  it("writes a post as a published row with its poster, file and duration", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [POPULAR]: listingHtml([{ id: "67284", title: "Evening in velvet" }]),
      [`${BASE}/p/67284/`]: postHtml({ title: "Evening in velvet" }),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(report.imported).toBe(1);
    expect(inserted[0]).toMatchObject({
      title: "Evening in velvet",
      provider: DAMPLIPS_PROVIDER,
      provider_file_id: "67284",
      playable_url: "https://video.damplips.com/video7/1/2.mp4",
      embed_url: null,
      thumbnail_url: "https://video.damplips.com/pics/og.jpg",
      duration_seconds: 754,
      view_count: 1200,
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      published_at: "2026-01-02T03:04:05.000Z",
      requires_reupload: false,
    });
  });

  it("walks the popular feeds first, then the taxonomy, then the searches", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({
      [POPULAR]: listingHtml([{ id: "11111", title: "Popular clip" }]),
      [`${BASE}/p/11111/`]: postHtml({ title: "Popular clip" }),
    });

    await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(fetched[0]).toBe(POPULAR);
    expect(fetched[1]).toBe(`${BASE}/p/11111/`);
    // The plan is the documented order, and every source is a damplips page.
    const plan = sourcePlan("amateur");
    expect(plan.slice(0, 2).map((entry) => entry.kind)).toEqual(["popular", "popular"]);
    expect(plan[2].url).toBe(TAXONOMY);
    expect(plan.at(-1)?.url).toBe(searchUrlLast());
    expect(plan.some((entry) => entry.url === SEARCH)).toBe(true);
    expect(plan.every((entry) => entry.url.startsWith(BASE))).toBe(true);
  });

  it("keeps going through a popular feed the site does not serve", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({
      // Only the taxonomy has anything on it.
      [TAXONOMY]: listingHtml([{ id: "22222", title: "From the category page" }]),
      [`${BASE}/p/22222/`]: postHtml({ title: "From the category page" }),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );

    expect(fetched[0]).toBe(POPULAR);
    expect(fetched[1]).toBe(POPULAR_ALT);
    expect(fetched[2]).toBe(TAXONOMY);
    expect(report.imported).toBe(1);
    // A missing popular feed is reported as not served, not as an error.
    expect(report.errors).toEqual([]);
    expect(report.sources.find((entry) => entry.kind === "popular")?.found).toBe(false);
  });

  it("never writes a post that is already in the catalog", async () => {
    const { service, inserted } = createService(["67284"]);
    const { fetchPage, fetched } = createFetcher({
      [POPULAR]: listingHtml([
        { id: "67284", title: "Already imported" },
        { id: "67285", title: "Brand new" },
      ]),
      [`${BASE}/p/67284/`]: postHtml({ title: "Already imported" }),
      [`${BASE}/p/67285/`]: postHtml({ title: "Brand new" }),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(report.imported).toBe(1);
    expect(report.duplicates).toBe(1);
    expect(inserted.map((row) => row.provider_file_id)).toEqual(["67285"]);
    // The already-known post is not opened again: its page costs a request.
    expect(fetched).not.toContain(`${BASE}/p/67284/`);
  });

  it("imports a post listed twice only once", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [POPULAR]: listingHtml([{ id: "33333", title: "Popular one" }]),
      [TAXONOMY]: listingHtml([{ id: "33333", title: "Popular one" }]),
      [`${BASE}/p/33333/`]: postHtml({ title: "Popular one" }),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );

    expect(inserted).toHaveLength(1);
    expect(report.duplicates).toBeGreaterThanOrEqual(1);
  });

  it("skips a post with no playable file and one with no poster", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [POPULAR]: listingHtml([
        // A card survives the listing parser only with a poster or a long
        // headline; the two broken posts below fail later, on their own page.
        { id: "44444", title: "A post whose player is gone" },
        { id: "44445", title: "A post whose poster is not an image", poster: `${BASE}/p/44445/` },
        { id: "44446", title: "Perfectly fine" },
      ]),
      [`${BASE}/p/44444/`]: postHtml({ title: "A post whose player is gone", media: null }),
      [`${BASE}/p/44445/`]: postHtml({ title: "A post whose poster is not an image", poster: null }),
      [`${BASE}/p/44446/`]: postHtml({ title: "Perfectly fine" }),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(report.imported).toBe(1);
    expect(inserted.map((row) => row.provider_file_id)).toEqual(["44446"]);
    expect(report.skipped.missingMedia).toBe(1);
    expect(report.skipped.missingThumbnail).toBe(1);
  });

  it("falls back to the listing poster when the page advertises none", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [POPULAR]: listingHtml([
        { id: "55555", title: "Poster only on the listing", poster: "https://video.damplips.com/pics/55.jpg" },
      ]),
      [`${BASE}/p/55555/`]: postHtml({ title: "Poster only on the listing", poster: null }),
    });

    await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(inserted[0].thumbnail_url).toBe("https://video.damplips.com/pics/55.jpg");
  });

  it("skips teasers shorter than a minute", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [POPULAR]: listingHtml([
        { id: "66666", title: "A full scene" },
        { id: "66667", title: "A twelve second teaser" },
      ]),
      [`${BASE}/p/66666/`]: postHtml({ title: "A full scene", duration: "900" }),
      [`${BASE}/p/66667/`]: postHtml({ title: "A twelve second teaser", duration: "12" }),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.imported).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(report.skipped.short).toBe(1);
  });

  it("stops at the post budget and hands back a cursor mid-page", async () => {
    const { service, inserted } = createService();
    const { fetchPage, fetched } = createFetcher({
      [POPULAR]: listingHtml([
        { id: "70001", title: "The first clip" },
        { id: "70002", title: "The second clip" },
        { id: "70003", title: "The third clip" },
      ]),
      [`${BASE}/p/70001/`]: postHtml({ title: "The first clip" }),
      [`${BASE}/p/70002/`]: postHtml({ title: "The second clip" }),
      [`${BASE}/p/70003/`]: postHtml({ title: "The third clip" }),
    });

    const first = await importCategorySlice(
      { categorySlug: "amateur", postsPerRequest: 2 },
      deps(fetchPage, service),
    );

    expect(first.imported).toBe(2);
    expect(first.exhausted).toBe(false);
    expect(first.cursor).toMatchObject({ source: 0, page: 1, skip: 2, url: POPULAR });
    expect(fetched.filter((url) => url.includes("/p/"))).toHaveLength(2);

    const second = await importCategorySlice(
      { categorySlug: "amateur", cursor: first.cursor, postsPerRequest: 2 },
      deps(fetchPage, service),
    );

    expect(second.imported).toBe(1);
    expect(inserted.map((row) => row.provider_file_id)).toEqual(["70001", "70002", "70003"]);
  });

  it("follows the pagination the listing itself prints", async () => {
    const { service } = createService();
    const page2 = `${POPULAR}page/2/`;
    const { fetchPage, fetched } = createFetcher({
      [POPULAR]: listingHtml([{ id: "80001", title: "The page one clip" }], page2),
      [page2]: listingHtml([{ id: "80002", title: "The page two clip" }]),
      [`${BASE}/p/80001/`]: postHtml({ title: "The page one clip" }),
      [`${BASE}/p/80002/`]: postHtml({ title: "The page two clip" }),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );

    expect(fetched).toContain(page2);
    expect(report.imported).toBe(2);
  });

  it("walks every listing before reporting exhaustion", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({});

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );

    expect(report.exhausted).toBe(true);
    expect(report.imported).toBe(0);
    expect(fetched).toEqual(sourcePlan("amateur").map((entry) => entry.url));
  });

  it("does not cap a run at a fixed number of videos", async () => {
    const { service, inserted } = createService();
    const posts = Array.from({ length: 40 }, (_, index) => ({
      id: `900${String(index).padStart(5, "0")}`,
      title: `A damplips clip number ${index}`,
    }));
    const pages: Record<string, string> = { [POPULAR]: listingHtml(posts) };
    for (const post of posts) {
      pages[`${BASE}/p/${post.id}/`] = postHtml({ title: post.title });
    }
    const { fetchPage } = createFetcher(pages);

    const report = await importCategorySlice(
      { categorySlug: "amateur", postsPerRequest: 60 },
      deps(fetchPage, service),
    );

    // 40 in one slice: an import has no reason to stop at 10 or 25.
    expect(report.imported).toBe(40);
    expect(inserted).toHaveLength(40);
  });

  it("clamps an absurd budget instead of trusting the caller", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({});
    await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: 10_000, postsPerRequest: 10_000 },
      deps(fetchPage, service),
    );
    expect(fetched.length).toBeLessThanOrEqual(MAX_PAGES_PER_REQUEST);
  });

  it("writes nothing in a dry run but still reports what it would import", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [POPULAR]: listingHtml([{ id: "12321", title: "Would be imported" }]),
      [`${BASE}/p/12321/`]: postHtml({ title: "Would be imported" }),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", dryRun: true },
      deps(fetchPage, service),
    );

    expect(report.imported).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(report.samples[0]).toMatchObject({ sourceId: "12321", sourceUrl: `${BASE}/p/12321/` });
  });

  it("stages drafts as private rows when rights are pending", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [POPULAR]: listingHtml([{ id: "54321", title: "Needs review" }]),
      [`${BASE}/p/54321/`]: postHtml({ title: "Needs review" }),
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

  it("records an unreadable post page and keeps going", async () => {
    const { service } = createService();
    const fetchPage: FetchDamplipsPage = async (url) => {
      if (url === `${BASE}/p/99991/`) throw new Error("damplips responded 500");
      if (url === POPULAR) {
        return {
          url,
          html: listingHtml([
            { id: "99991", title: "Broken page" },
            { id: "99992", title: "Healthy page" },
          ]),
          status: 200,
        };
      }
      return { url, html: postHtml({ title: "Healthy page" }), status: 200 };
    };

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    expect(report.imported).toBe(1);
    expect(report.errors[0]).toContain("500");
  });

  it("refuses a category that has no configured source", async () => {
    const { service } = createService();
    const { fetchPage } = createFetcher({});
    await expect(
      importCategorySlice({ categorySlug: "not-a-category" }, deps(fetchPage, service)),
    ).rejects.toThrow(/No damplips source/);
  });

  it("fixes stored rows whose poster is missing or is not an image", async () => {
    const { service, rows, updates } = createService();
    rows.set("row-keep", {
      id: "row-keep",
      provider: DAMPLIPS_PROVIDER,
      provider_file_id: "60001",
      thumbnail_url: "https://video.damplips.com/pics/good.jpg",
    });
    rows.set("row-null", {
      id: "row-null",
      provider: DAMPLIPS_PROVIDER,
      provider_file_id: "60002",
      thumbnail_url: null,
    });
    rows.set("row-page", {
      id: "row-page",
      provider: DAMPLIPS_PROVIDER,
      provider_file_id: "60003",
      thumbnail_url: "https://www.damplips.com/p/60003/",
    });

    const { fetchPage, fetched } = createFetcher({
      [`${BASE}/p/60002/`]: postHtml({
        title: "Fixed null",
        poster: "https://video.damplips.com/pics/60002.jpg",
      }),
      [`${BASE}/p/60003/`]: postHtml({
        title: "Fixed page",
        poster: "https://video.damplips.com/pics/60003.jpg",
      }),
    });

    const result = await repairThumbnails({ service, fetchPage, delayMs: 0 });

    expect(result.repaired).toBe(2);
    expect(updates.map((update) => update.id).sort()).toEqual(["row-null", "row-page"]);
    expect(rows.get("row-null")?.thumbnail_url).toBe("https://video.damplips.com/pics/60002.jpg");
    expect(rows.get("row-page")?.thumbnail_url).toBe("https://video.damplips.com/pics/60003.jpg");
    // A healthy row is never re-read.
    expect(fetched.join(" ")).not.toContain("60001");
  });

  it("reports how many stored posters a slice repaired", async () => {
    const { service, rows } = createService();
    rows.set("row-null", {
      id: "row-null",
      provider: DAMPLIPS_PROVIDER,
      provider_file_id: "61000",
      thumbnail_url: null,
    });
    const { fetchPage } = createFetcher({
      [`${BASE}/p/61000/`]: postHtml({
        title: "Fixed null",
        poster: "https://video.damplips.com/pics/61000.jpg",
      }),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", repair: true },
      deps(fetchPage, service),
    );
    expect(report.repaired).toBe(1);
  });

  it("recognises a displayable poster URL", () => {
    expect(looksLikePoster("https://video.damplips.com/pics/x.jpg")).toBe(true);
    expect(looksLikePoster("https://www.damplips.com/p/60003/")).toBe(false);
    expect(looksLikePoster("https://video.damplips.com/pics/x.gif")).toBe(false);
    expect(looksLikePoster(null)).toBe(false);
    expect(looksLikePoster("data:image/gif;base64,R0lGOD")).toBe(false);
  });
});

/** The last search of the amateur plan, built the way the plan builds it. */
function searchUrlLast(): string {
  return searchUrl("amateur porn");
}
