// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DAMPLIPS_PROVIDER,
  IMPORT_TARGET,
  MAX_IMPORT_TARGET,
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
 * so these tests drive whole rounds against a fixture site and an in-memory
 * catalog:
 *
 *  - a round imports its 100 new videos — it is measured in rows written, not in
 *    pages read, and it never comes back empty while there is anything left;
 *  - a video found through a category it does not belong to is imported with no
 *    category instead of being mislabelled or dropped;
 *  - nothing is written twice, whether it is already in the database or appears
 *    on two listings of the same run;
 *  - post pages are opened concurrently and the media host is not probed per
 *    video, which is what makes a round of 100 cheap;
 *  - the cursor resumes exactly where the previous call stopped, so an unlimited
 *    run is just "call again until the operator presses Stop".
 */

type Row = Record<string, unknown>;

const BASE = "https://www.damplips.com";
const POPULAR = `${BASE}/most-popular/`;
const POPULAR_ALT = `${BASE}/popular/`;
const TAXONOMY = `${BASE}/c/amateur-porn/`;

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
  /** Taxonomy the post files itself under — the "is it really this category?" signal. */
  categorySlug?: string | null;
  tags?: string[];
  related?: string[];
}): string {
  const poster =
    options.poster === null
      ? ""
      : `<meta property="og:image" content="${options.poster ?? "https://video.damplips.com/pics/og.jpg"}" />`;
  const media =
    options.media === null
      ? ""
      : `<meta property="og:video" content="${options.media ?? "https://video.damplips.com/video7/1/2.mp4"}" />`;
  const category = options.categorySlug
    ? `<p class="entry-categories"><a rel="category tag" href="/c/${options.categorySlug}/">${options.categorySlug}</a></p>`
    : "";
  const tags = options.tags?.length
    ? `<meta property="article:tag" content="${options.tags.join(",")}" />`
    : "";
  const related = options.related?.length
    ? `<div class="related-videos">${options.related
        .map((id) => `<a href="/p/${id}/">Related ${id}</a>`)
        .join("")}</div>`
    : "";
  return `<html><head>
    <meta property="og:title" content="${options.title}" />
    ${poster}
    ${media}
    ${tags}
    <meta property="video:duration" content="${options.duration ?? "754"}" />
  </head><body>
    ${category}
    <span class="views">${options.views ?? "1200"} views</span>
    ${related}
  </body></html>`;
}

/** A fake PostgREST client: filters, reads, batched inserts and updates. */
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
  /** How many insert calls reached the database, batched or not. */
  let insertCalls = 0;

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
          insertCalls += 1;
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

  return { service, inserted, updates, rows, insertCalls: () => insertCalls };
}

/** A fake damplips: URL → HTML. Unknown pages are empty listings. */
function createFetcher(pages: Record<string, string>, options: { delayMs?: number } = {}) {
  const fetched: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchPage: FetchDamplipsPage = async (url) => {
    fetched.push(url);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return { url, html: pages[url] ?? listingHtml([]), status: 200 };
    } finally {
      inFlight -= 1;
    }
  };
  return { fetchPage, fetched, peak: () => peak };
}

function deps(fetchPage: FetchDamplipsPage, service: unknown, extra: Partial<DamplipsImportDeps> = {}) {
  return {
    fetchPage,
    service: service as DamplipsImportDeps["service"],
    categoryId: "cat-amateur",
    delayMs: 0,
    fetchHostMedia: async (url) => url,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    ...extra,
  } as DamplipsImportDeps;
}

/** A fixture site with `count` healthy posts, listed `perPage` at a time. */
function site(count: number, options: { perPage?: number; categorySlug?: string } = {}) {
  const perPage = options.perPage ?? 20;
  const pages: Record<string, string> = {};
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = String(100000 + index);
    ids.push(id);
    pages[`${BASE}/p/${id}/`] = postHtml({
      title: `Amateur scene number ${index} filmed at home`,
      categorySlug: options.categorySlug ?? "amateur-porn",
    });
  }
  const pageCount = Math.ceil(count / perPage);
  for (let page = 1; page <= pageCount; page += 1) {
    const slice = ids.slice((page - 1) * perPage, page * perPage);
    const url = page === 1 ? TAXONOMY : `${TAXONOMY}page/${page}/`;
    const next = page < pageCount ? `${TAXONOMY}page/${page + 1}/` : undefined;
    pages[url] = listingHtml(
      slice.map((id) => ({ id, title: `Amateur scene number ${id} filmed at home` })),
      next,
    );
  }
  return { pages, ids };
}

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

  it("imports 100 new videos in one round", async () => {
    const { pages, ids } = site(260);
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher(pages);

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(report.target).toBe(IMPORT_TARGET);
    expect(report.imported).toBe(100);
    expect(report.targetReached).toBe(true);
    expect(inserted).toHaveLength(100);
    // Exactly the first 100 posts of the popular feed, in page order.
    expect(inserted.map((row) => row.provider_file_id)).toEqual(ids.slice(0, 100));
    // And it stopped there rather than reading the whole fixture.
    expect(report.postsRead).toBe(100);
  });

  it("hands the next round a cursor that keeps importing, never an empty round", async () => {
    const { pages } = site(260);
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher(pages);

    const first = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));
    const second = await importCategorySlice(
      { categorySlug: "amateur", cursor: first.cursor },
      deps(fetchPage, service),
    );
    const third = await importCategorySlice(
      { categorySlug: "amateur", cursor: second.cursor, pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );

    expect([first.imported, second.imported, third.imported]).toEqual([100, 100, 60]);
    expect(inserted).toHaveLength(260);
    expect(new Set(inserted.map((row) => row.provider_file_id)).size).toBe(260);
    // The third round walked everything that was left; only then is a call
    // allowed to come back short, because the fixture site really is empty.
    expect(third.exhausted).toBe(true);
  });

  it("finds more videos through related links when the listings run out", async () => {
    // One listing page holds a single post; that post links to three others,
    // and those link to more. The frontier is what keeps the round going.
    const { service, inserted } = createService();
    const pages: Record<string, string> = {
      [TAXONOMY]: listingHtml([{ id: "50001", title: "The only listed clip" }]),
      [`${BASE}/p/50001/`]: postHtml({
        title: "The only listed clip",
        categorySlug: "amateur-porn",
        related: ["50002", "50003", "50004"],
      }),
      [`${BASE}/p/50002/`]: postHtml({ title: "Related clip two", related: ["50005"] }),
      [`${BASE}/p/50003/`]: postHtml({ title: "Related clip three" }),
      [`${BASE}/p/50004/`]: postHtml({ title: "Related clip four" }),
      [`${BASE}/p/50005/`]: postHtml({ title: "Related clip five" }),
    };
    const { fetchPage } = createFetcher(pages);

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: 1, postsPerRequest: 40 },
      deps(fetchPage, service),
    );

    expect(inserted.map((row) => row.provider_file_id).sort()).toEqual([
      "50001",
      "50002",
      "50003",
      "50004",
      "50005",
    ]);
    expect(report.imported).toBe(5);
    // Those related posts are not in the amateur category, so they are imported
    // with no category rather than mislabelled under "Amateur".
    expect(inserted.find((row) => row.provider_file_id === "50001")?.category_id).toBe("cat-amateur");
    expect(inserted.find((row) => row.provider_file_id === "50002")?.category_id).toBeNull();
    expect(report.uncategorised).toBe(4);
  });

  it("imports a video that is not from the category, with no category tag", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [TAXONOMY]: listingHtml([
        { id: "61001", title: "A redhead on a sofa" },
        { id: "61002", title: "An amateur afternoon at home" },
      ]),
      // No taxonomy at all, and a title with nothing in common with "amateur".
      [`${BASE}/p/61001/`]: postHtml({ title: "A redhead on a sofa" }),
      // Filed under the category itself.
      [`${BASE}/p/61002/`]: postHtml({ title: "An afternoon at home", categorySlug: "amateur-porn" }),
    });

    const report = await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    expect(report.imported).toBe(2);
    expect(report.uncategorised).toBe(1);
    expect(inserted.find((row) => row.provider_file_id === "61001")?.category_id).toBeNull();
    expect(inserted.find((row) => row.provider_file_id === "61002")?.category_id).toBe("cat-amateur");
    // Both are published: an uncategorised video is still a real catalog video.
    expect(inserted.every((row) => row.status === "published")).toBe(true);
  });

  it("opens post pages concurrently and does not probe the media host per video", async () => {
    const { pages } = site(40);
    const { service } = createService();
    const { fetchPage, peak } = createFetcher(pages, { delayMs: 5 });
    let hostProbes = 0;

    await importCategorySlice(
      { categorySlug: "amateur" },
      deps(fetchPage, service, {
        fetchHostMedia: async (url) => {
          hostProbes += 1;
          return url;
        },
      }),
    );

    // Several post pages in flight at once: a round is not one request at a time.
    expect(peak()).toBeGreaterThan(1);
    // The file URL came from the page that serves it; no extra request per video.
    expect(hostProbes).toBe(0);
  });

  it("probes the media host only when the caller asks for it", async () => {
    const { pages } = site(3);
    const { service } = createService();
    const { fetchPage } = createFetcher(pages);
    let hostProbes = 0;

    await importCategorySlice(
      { categorySlug: "amateur", verifyMedia: true },
      deps(fetchPage, service, {
        fetchHostMedia: async (url) => {
          hostProbes += 1;
          return url;
        },
      }),
    );

    expect(hostProbes).toBe(3);
  });

  it("writes rows in batches instead of one insert per video", async () => {
    const { pages } = site(40);
    const { service, insertCalls } = createService();
    const { fetchPage } = createFetcher(pages);

    await importCategorySlice({ categorySlug: "amateur" }, deps(fetchPage, service));

    // 40 rows in two batches of 25 and 15, not 40 separate inserts.
    expect(insertCalls()).toBeLessThanOrEqual(3);
  });

  it("fills the selected category first, then the popular feeds, the searches and the archives", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({
      [TAXONOMY]: listingHtml([{ id: "11111", title: "Popular clip" }]),
      [`${BASE}/p/11111/`]: postHtml({ title: "Popular clip", categorySlug: "amateur-porn" }),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", importTarget: 5 },
      deps(fetchPage, service),
    );

    // A round is spent on the category the operator selected before anything
    // else, so the category page actually fills.
    expect(fetched[0]).toBe(TAXONOMY);
    expect(fetched[1]).toBe(`${BASE}/p/11111/`);
    expect(report.imported).toBe(1);

    const plan = sourcePlan("amateur");
    expect(plan[0].kind).toBe("taxonomy");
    // Popular videos come next, before search results and before the archive.
    const kinds = plan.map((entry) => entry.kind);
    expect(kinds.indexOf("popular")).toBeGreaterThan(kinds.lastIndexOf("taxonomy"));
    expect(kinds.indexOf("popular")).toBeLessThan(kinds.indexOf("search"));
    expect(plan.some((entry) => entry.url === searchUrl("amateur"))).toBe(true);
    // The newest archives are the depth behind a round of 100.
    expect(plan.at(-3)?.kind).toBe("latest");
    expect(plan.every((entry) => entry.url.startsWith(BASE))).toBe(true);
  });

  it("keeps going through a popular feed the site does not serve", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({
      [TAXONOMY]: listingHtml([{ id: "22222", title: "From the category page" }]),
      [`${BASE}/p/22222/`]: postHtml({ title: "From the category page", categorySlug: "amateur-porn" }),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: MAX_PAGES_PER_REQUEST },
      deps(fetchPage, service),
    );

    // The category's own page is served, and the popular feeds are then tried
    // in order; a feed the site does not serve is not an error.
    expect(fetched[0]).toBe(TAXONOMY);
    expect(fetched).toContain(POPULAR);
    expect(fetched).toContain(POPULAR_ALT);
    expect(report.imported).toBe(1);
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

  it("salvages the rest of a batch when one row races the unique index", async () => {
    const { service, rows } = createService();
    const { fetchPage } = createFetcher({
      [TAXONOMY]: listingHtml([
        { id: "31001", title: "One of the three clips" },
        { id: "31002", title: "Two of the three clips" },
        { id: "31003", title: "Three of the three clips" },
      ]),
      [`${BASE}/p/31001/`]: postHtml({ title: "One of the three clips" }),
      [`${BASE}/p/31002/`]: postHtml({ title: "Two of the three clips" }),
      [`${BASE}/p/31003/`]: postHtml({ title: "Three of the three clips" }),
    });

    // Another run inserts the middle row between the lookup and the insert.
    const original = service.from.bind(service);
    const racing = {
      from(table: string) {
        const api = original(table) as Record<string, unknown>;
        return {
          ...api,
          insert: async (input: Row | Row[]) => {
            const batch = Array.isArray(input) ? input : [input];
            const ids = batch.map((row) => String(row.provider_file_id));
            if (ids.includes("31002") && ids.length > 1) {
              rows.set("row-other", {
                id: "row-other",
                provider: DAMPLIPS_PROVIDER,
                provider_file_id: "31002",
              });
            }
            return (api.insert as (value: Row | Row[]) => Promise<unknown>)(input);
          },
        };
      },
    };

    const report = await importCategorySlice(
      { categorySlug: "amateur" },
      deps(fetchPage, racing as unknown as DamplipsImportDeps["service"]),
    );

    expect(report.imported).toBe(2);
    expect(report.duplicates).toBe(1);
    expect([...rows.values()].map((row) => row.provider_file_id).sort()).toEqual([
      "31001",
      "31002",
      "31003",
    ]);
  });

  it("imports a post listed twice only once", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [TAXONOMY]: listingHtml([{ id: "33333", title: "Popular one" }]),
      [POPULAR]: listingHtml([{ id: "33333", title: "Popular one" }]),
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
      [TAXONOMY]: listingHtml([
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
      [TAXONOMY]: listingHtml([
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
      [TAXONOMY]: listingHtml([
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
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: `7000${index}`,
      title: `A clip numbered ${index} on the page`,
    }));
    const pages: Record<string, string> = { [TAXONOMY]: listingHtml(many) };
    for (const post of many) pages[`${BASE}/p/${post.id}/`] = postHtml({ title: post.title });
    const { fetchPage } = createFetcher(pages);

    const first = await importCategorySlice(
      { categorySlug: "amateur", postsPerRequest: 3 },
      deps(fetchPage, service),
    );

    expect(first.imported).toBeLessThanOrEqual(6);
    expect(first.exhausted).toBe(false);
    expect(first.cursor).toMatchObject({ source: 0, page: 1, url: TAXONOMY });
    expect(first.cursor.skip).toBeGreaterThan(0);

    const second = await importCategorySlice(
      { categorySlug: "amateur", cursor: first.cursor, postsPerRequest: 20 },
      deps(fetchPage, service),
    );

    // The second call picks up from the exact card the first one stopped on.
    expect(first.imported + second.imported).toBe(9);
    expect(inserted.map((row) => row.provider_file_id)).toEqual(many.map((post) => post.id));
  });

  it("follows the pagination the listing itself prints", async () => {
    const { service } = createService();
    const page2 = `${TAXONOMY}page/2/`;
    const { fetchPage, fetched } = createFetcher({
      [TAXONOMY]: listingHtml([{ id: "80001", title: "The page one clip" }], page2),
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
    expect(report.targetReached).toBe(false);
    expect(report.imported).toBe(0);
    expect(report.cursor.queue ?? []).toEqual([]);
    expect(fetched).toEqual(sourcePlan("amateur").map((entry) => entry.url));
  });

  it("is not capped at a fixed number of videos", async () => {
    const { pages } = site(500);
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher(pages);

    const report = await importCategorySlice(
      {
        categorySlug: "amateur",
        importTarget: MAX_IMPORT_TARGET,
        pagesPerRequest: MAX_PAGES_PER_REQUEST,
      },
      deps(fetchPage, service),
    );

    // A caller may ask for a bigger round; nothing caps it below that.
    expect(report.imported).toBe(MAX_IMPORT_TARGET);
    expect(inserted).toHaveLength(MAX_IMPORT_TARGET);
  });

  it("clamps an absurd budget instead of trusting the caller", async () => {
    const { service } = createService();
    const { fetchPage, fetched } = createFetcher({});
    const report = await importCategorySlice(
      { categorySlug: "amateur", pagesPerRequest: 10_000, postsPerRequest: 10_000, importTarget: 10_000 },
      deps(fetchPage, service),
    );
    expect(fetched.length).toBeLessThanOrEqual(MAX_PAGES_PER_REQUEST);
    expect(report.target).toBe(MAX_IMPORT_TARGET);
  });

  it("writes nothing in a dry run but still reports what it would import", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [TAXONOMY]: listingHtml([{ id: "12321", title: "Would be imported" }]),
      [`${BASE}/p/12321/`]: postHtml({ title: "Would be imported", categorySlug: "amateur-porn" }),
    });

    const report = await importCategorySlice(
      { categorySlug: "amateur", dryRun: true },
      deps(fetchPage, service),
    );

    expect(report.imported).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(report.samples[0]).toMatchObject({
      sourceId: "12321",
      sourceUrl: `${BASE}/p/12321/`,
      categorised: true,
    });
  });

  it("stages drafts as private rows when rights are pending", async () => {
    const { service, inserted } = createService();
    const { fetchPage } = createFetcher({
      [TAXONOMY]: listingHtml([{ id: "54321", title: "Needs review" }]),
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
      if (url === TAXONOMY) {
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
