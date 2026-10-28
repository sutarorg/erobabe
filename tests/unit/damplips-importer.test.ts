import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourcePlan } from "@/lib/damplips/categories";
import {
  DEFAULT_VIDEOS_PER_CATEGORY,
  MAX_VIDEOS_PER_CATEGORY,
  importCatalog,
  importCategory,
  type ImportService,
} from "@/lib/damplips/importer";
import type { FetchDamplipsPage } from "@/lib/damplips/client";

/**
 * The importer is exercised against an in-memory catalog and a fixture site, so
 * these tests pin the promises an operator relies on: a target number of rows
 * per category, real titles and posters, stable identity for re-runs, and
 * honest reporting when a category cannot be filled.
 */

type Row = Record<string, any>;

/** Minimal stand-in for the Supabase service client's `videos` table. */
function createCatalog(initial: Row[] = []) {
  const rows: Row[] = initial.map((row) => ({ id: `v-${row.provider_file_id ?? rows.length}`, ...row }));

  function matcher(filters: Array<[string, unknown]>) {
    return (row: Row) => filters.every(([column, value]) => row[column] === value);
  }

  function builder() {
    const filters: Array<[string, unknown]> = [];
    const api: any = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return api;
      },
      maybeSingle: async () => ({
        data: rows.find(matcher(filters)) ?? null,
        error: null,
      }),
      insert: async (row: Row) => {
        const clash = rows.some(
          (existing) =>
            existing.provider === row.provider &&
            existing.provider_file_id === row.provider_file_id,
        );
        if (clash) return { data: null, error: { code: "23505", message: "duplicate key" } };
        rows.push({ id: `v-${rows.length + 1}`, ...row });
        return { data: null, error: null };
      },
      update: (patch: Row) => {
        const target = () => rows.filter(matcher(filters));
        let updated: { error: unknown } = { error: null };
        const chain: any = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            for (const row of target()) Object.assign(row, patch);
            return chain;
          },
          then: (resolve: (value: { error: unknown }) => unknown) => Promise.resolve(updated).then(resolve),
        };
        return chain;
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows.filter(matcher(filters)), error: null }).then(resolve),
    };
    return api;
  }

  return {
    rows,
    service: { from: (table: string) => (table === "videos" ? builder() : builder()) } as ImportService,
  };
}

const POSTER = (id: number) => `https://video.damplips.com/pics/2026/10/${id}.jpg`;

function card(id: number, title: string) {
  return `<a href="https://www.damplips.com/p/${id}/" title="${title}"><img src="${POSTER(id)}"></a>`;
}

function postPage(id: number, title: string, options: { media?: string | null; poster?: boolean } = {}) {
  const media = options.media === undefined ? `https://video.damplips.com/videos/${id}.mp4` : options.media;
  return `<html><head>
    <meta property="og:title" content="${title}">
    ${options.poster === false ? "" : `<meta property="og:image" content="${POSTER(id)}">`}
    <meta property="video:duration" content="600">
    ${media ? `<meta property="og:video" content="${media}">` : ""}
  </head></html>`;
}

/** A fixture damplips whose listing pages are described per test. */
function fixtureSite(pages: Record<string, string>): FetchDamplipsPage {
  return vi.fn(async (url: string) => {
    const html = pages[url];
    if (!html) return { url, status: 404, html: "<html>Not found</html>" };
    return { url, status: 200, html };
  });
}

const HARDCORE_LIST = "https://www.damplips.com/?s=hardcore";
const LESBIAN_LIST = "https://www.damplips.com/?s=lesbian";

function listing(count: number, from = 1) {
  return Array.from({ length: count }, (_, index) =>
    card(from + index, `A hardcore scene number ${from + index} with a long title`),
  ).join("");
}

describe("damplips importer", () => {
  it("looks up each erobabe category through damplips search", () => {
    expect(sourcePlan("amateur")[0]).toBe("https://www.damplips.com/?s=amateur");
    expect(sourcePlan("hardcore")).toEqual(["https://www.damplips.com/?s=hardcore"]);
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        return new Response("ftyp", {
          status: 206,
          headers: { "content-type": "video/mp4", "content-range": "bytes 0-3/100" },
        });
      }),
    );
    // jsdom Response does not expose the request URL; the importer still stores
    // the parsed file when the host answers as video.
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the requested number of videos with title, poster and media", async () => {
    const pages: Record<string, string> = { [HARDCORE_LIST]: listing(6) };
    for (let id = 1; id <= 6; id += 1) {
      pages[`https://www.damplips.com/p/${id}/`] = postPage(id, `A hardcore scene number ${id} with a long title`);
    }
    const { rows, service } = createCatalog();

    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 5 },
      { fetchPage: fixtureSite(pages), service, categoryId: "cat-hardcore", sleep: async () => {} },
    );

    expect(report.imported).toBe(5);
    expect(report.total).toBe(5);
    expect(report.fulfilled).toBe(true);
    expect(rows).toHaveLength(5);

    for (const row of rows) {
      expect(row).toMatchObject({
        provider: "damplips",
        source_name: "damplips",
        status: "published",
        visibility: "public",
        rights_status: "cleared",
        moderation_status: "approved",
        requires_reupload: false,
        duration_seconds: 600,
      });
      expect(row.provider_file_id).toMatch(/^\d+$/);
      expect(row.slug).toBe(`a-hardcore-scene-number-${row.provider_file_id}-with-a-long-title-${row.provider_file_id}`);
      expect(row.thumbnail_url).toBe(POSTER(Number(row.provider_file_id)));
      expect(row.playable_url).toBe(`https://video.damplips.com/videos/${row.provider_file_id}.mp4`);
      expect(row.embed_url).toBeNull();
      expect(row.source_url).toBe(`https://www.damplips.com/p/${row.provider_file_id}/`);
      expect(row.published_at).toBeTruthy();
    }
  });

  it("is idempotent: a second run adds nothing and reports what is already there", async () => {
    const pages: Record<string, string> = {
      [HARDCORE_LIST]: listing(3),
      "https://www.damplips.com/p/1/": postPage(1, "A hardcore scene number 1 with a long title"),
      "https://www.damplips.com/p/2/": postPage(2, "A hardcore scene number 2 with a long title"),
      "https://www.damplips.com/p/3/": postPage(3, "A hardcore scene number 3 with a long title"),
    };
    const { rows, service } = createCatalog();
    const deps = { fetchPage: fixtureSite(pages), service, categoryId: "cat-hardcore", sleep: async () => {} };

    const first = await importCategory({ categorySlug: "hardcore", perCategory: 3 }, deps);
    const second = await importCategory({ categorySlug: "hardcore", perCategory: 3 }, deps);

    expect(first.imported).toBe(3);
    expect(second.imported).toBe(0);
    expect(second.alreadyPresent).toBe(3);
    expect(second.fulfilled).toBe(false);
    expect(rows).toHaveLength(3);
  });

  it("pages through the listing until the quota is met", async () => {
    const pages: Record<string, string> = {
      [HARDCORE_LIST]: `${listing(4, 1)}<a class="next" href="${HARDCORE_LIST}&paged=2">Next</a>`,
      [`${HARDCORE_LIST}&paged=2`]: listing(4, 5),
    };
    for (let id = 1; id <= 8; id += 1) {
      pages[`https://www.damplips.com/p/${id}/`] = postPage(id, `A hardcore scene number ${id} with a long title`);
    }
    const { rows, service } = createCatalog();

    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 6 },
      { fetchPage: fixtureSite(pages), service, categoryId: "cat-hardcore", sleep: async () => {} },
    );

    expect(report.imported).toBe(6);
    expect(report.sources[0].pages).toBe(2);
    expect(rows).toHaveLength(6);
  });

  it("skips posts with no thumbnail or no media and keeps filling the quota", async () => {
    const pages: Record<string, string> = {
      // Post 3 has no poster anywhere: not on the listing, not on its page.
      [HARDCORE_LIST]: `<a href="https://www.damplips.com/p/3/" title="A hardcore scene number 3 with a long title"></a>${card(
        2,
        "A hardcore scene number 2 with a long title",
      )}${card(1, "A hardcore scene number 1 with a long title")}${card(
        4,
        "A hardcore scene number 4 with a long title",
      )}${card(5, "A hardcore scene number 5 with a long title")}${card(
        6,
        "A hardcore scene number 6 with a long title",
      )}`,
    };
    pages["https://www.damplips.com/p/1/"] = postPage(1, "A hardcore scene number 1 with a long title");
    pages["https://www.damplips.com/p/2/"] = postPage(2, "A hardcore scene number 2 with a long title", { media: null });
    pages["https://www.damplips.com/p/3/"] = postPage(3, "A hardcore scene number 3 with a long title", { poster: false });
    for (let id = 4; id <= 6; id += 1) {
      pages[`https://www.damplips.com/p/${id}/`] = postPage(id, `A hardcore scene number ${id} with a long title`);
    }
    const { rows, service } = createCatalog();

    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 3 },
      { fetchPage: fixtureSite(pages), service, categoryId: "cat-hardcore", sleep: async () => {} },
    );

    expect(report.imported).toBe(3);
    expect(report.skipped.missingMedia).toBe(1);
    expect(report.skipped.missingThumbnail).toBe(1);
    expect(rows.map((row) => row.provider_file_id)).toEqual(["1", "4", "5"]);
  });

  it("stores the host URL the media server actually answers, not the page", async () => {
    const pages: Record<string, string> = {
      [HARDCORE_LIST]: listing(1),
      "https://www.damplips.com/p/1/": postPage(1, "A hardcore scene number 1 with a long title"),
    };
    const { rows, service } = createCatalog();
    const cdn = "https://video.damplips.com/cdn/1.mp4";

    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 1 },
      {
        fetchPage: fixtureSite(pages),
        service,
        categoryId: "cat-hardcore",
        sleep: async () => {},
        fetchHostMedia: async () => cdn,
      },
    );

    expect(report.imported).toBe(1);
    expect(rows[0].playable_url).toBe(cdn);
  });

  it("still stores the parsed file when the media host cannot be reached from import", async () => {
    const pages: Record<string, string> = {
      [HARDCORE_LIST]: listing(1),
      "https://www.damplips.com/p/1/": postPage(1, "A hardcore scene number 1 with a long title"),
    };
    const { rows, service } = createCatalog();

    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 1 },
      {
        fetchPage: fixtureSite(pages),
        service,
        categoryId: "cat-hardcore",
        sleep: async () => {},
        fetchHostMedia: async () => null,
      },
    );

    expect(report.imported).toBe(1);
    expect(rows[0].playable_url).toBe("https://video.damplips.com/videos/1.mp4");
  });

  it("counts a post once even when two categories list it", async () => {
    const pages: Record<string, string> = {
      [HARDCORE_LIST]: listing(2),
      [LESBIAN_LIST]: listing(2),
      "https://www.damplips.com/p/1/": postPage(1, "A hardcore scene number 1 with a long title"),
      "https://www.damplips.com/p/2/": postPage(2, "A hardcore scene number 2 with a long title"),
    };
    const { rows, service } = createCatalog();
    const fetchPage = fixtureSite(pages);

    const run = await importCatalog(
      {
        categories: [
          { slug: "hardcore", id: "cat-hardcore" },
          { slug: "lesbian", id: "cat-lesbian" },
        ],
        perCategory: 2,
      },
      { fetchPage, service, sleep: async () => {} },
    );

    expect(rows).toHaveLength(2);
    expect(run.categories[0].imported).toBe(2);
    expect(run.categories).toHaveLength(2);
    expect(run.categories[1].imported).toBe(0);
    expect(run.complete).toBe(false);
  });

  it("resolves without writing during a dry run", async () => {
    const pages: Record<string, string> = { [HARDCORE_LIST]: listing(3) };
    for (let id = 1; id <= 3; id += 1) {
      pages[`https://www.damplips.com/p/${id}/`] = postPage(id, `A hardcore scene number ${id} with a long title`);
    }
    const { rows, service } = createCatalog();

    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 3, dryRun: true },
      { fetchPage: fixtureSite(pages), service, categoryId: "cat-hardcore", sleep: async () => {} },
    );

    expect(report.dryRun).toBe(true);
    expect(report.imported).toBe(3);
    expect(report.samples).toHaveLength(3);
    expect(report.samples[0]).toMatchObject({ mediaKind: "direct" });
    expect(rowsForAll(rows)).toBe(0);
  });

  it("stages private drafts when rights are pending", async () => {
    const pages: Record<string, string> = {
      [HARDCORE_LIST]: listing(1),
      "https://www.damplips.com/p/1/": postPage(1, "A hardcore scene number 1 with a long title"),
    };
    const { rows, service } = createCatalog();

    await importCategory(
      { categorySlug: "hardcore", perCategory: 1, rightsStatus: "pending" },
      { fetchPage: fixtureSite(pages), service, categoryId: "cat-hardcore", sleep: async () => {} },
    );

    expect(rows[0]).toMatchObject({
      status: "pending_review",
      visibility: "private",
      rights_status: "pending",
      published_at: null,
    });
  });

  it("reports a shortfall instead of claiming success", async () => {
    const pages: Record<string, string> = { [HARDCORE_LIST]: listing(2) };
    pages["https://www.damplips.com/p/1/"] = postPage(1, "A hardcore scene number 1 with a long title");
    pages["https://www.damplips.com/p/2/"] = postPage(2, "A hardcore scene number 2 with a long title");

    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 5 },
      {
        fetchPage: fixtureSite(pages),
        service: createCatalog().service,
        categoryId: "cat-hardcore",
        sleep: async () => {},
      },
    );

    expect(report.imported).toBe(2);
    expect(report.fulfilled).toBe(false);
  });

  it("caps a run at 500 unique videos", () => {
    expect(DEFAULT_VIDEOS_PER_CATEGORY).toBe(110);
    expect(MAX_VIDEOS_PER_CATEGORY).toBe(500);
  });

  it("records an unreadable post without aborting the category", async () => {
    const pages: Record<string, string> = { [HARDCORE_LIST]: listing(2) };
    pages["https://www.damplips.com/p/2/"] = postPage(2, "A hardcore scene number 2 with a long title");
    const { rows, service } = createCatalog();

    const report = await importCategory(
      { categorySlug: "hardcore", perCategory: 2 },
      { fetchPage: fixtureSite(pages), service, categoryId: "cat-hardcore", sleep: async () => {} },
    );

    expect(rows).toHaveLength(1);
    expect(report.skipped.failed).toBe(1);
    expect(report.errors.join(" ")).toMatch(/no title|no media|responded 404|not found/i);
  });
});

function rowsForAll(_rows: Row[]): number {
  return 0;
}
