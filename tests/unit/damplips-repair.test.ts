import { describe, expect, it } from "vitest";
import { repairDirectUrls } from "../../scripts/import-damplips";
import type { FetchDamplipsPage } from "@/lib/damplips/client";
import type { ImportService } from "@/lib/damplips/importer";

/**
 * `--repair` exists for rows that do not hold a direct media file: a post page,
 * or a `/api/videos/stream` address those were once resolved through. Those are
 * exactly the rows that sit on a preparation screen, so the repair pass stores
 * the file the post page publishes and leaves healthy rows untouched.
 */

type Row = Record<string, any>;

/** The query shapes `repairDirectUrls` uses: select → eq → order → range, update → eq. */
function fakeService(seed: Row[]): ImportService & { updates: Array<{ id: string; values: Row }> } {
  const rows = seed.map((row) => ({ ...row }));
  const updates: Array<{ id: string; values: Row }> = [];

  const from = (table: string) => {
    if (table !== "videos") throw new Error(`unexpected table ${table}`);
    const filters: Array<[string, unknown]> = [];
    const unique = (row: Row) => filters.every(([column, value]) => row[column] === value);
    const matched = () => rows.filter(unique);

    const api: any = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return api;
      },
      order: () => api,
      range: (fromIndex: number, toIndex: number) => {
        const page = matched().slice(fromIndex, toIndex + 1);
        return Promise.resolve({ data: page, error: null });
      },
      update: (values: Row) => ({
        eq: (column: string, value: unknown) => {
          const row = rows.find((candidate) => candidate[column] === value);
          if (row) Object.assign(row, values);
          updates.push({ id: String(value), values });
          return Promise.resolve({ error: null });
        },
      }),
    };
    return api;
  };

  return { from, updates };
}

function fetcher(pages: Record<string, string>): FetchDamplipsPage & { calls: string[] } {
  const calls: string[] = [];
  const fetchPage = (async (url: string) => {
    calls.push(url);
    const html = pages[url];
    if (!html) throw new Error(`unexpected fetch ${url}`);
    return { url, html, status: 200 };
  }) as FetchDamplipsPage & { calls: string[] };
  calls.forEach(() => undefined);
  Object.defineProperty(fetchPage, "calls", { value: calls });
  return fetchPage;
}

const POST_PAGE = (file: string, title = "A long enough listing headline") =>
  `<html><head>
     <meta property="og:title" content="${title}">
     <meta property="og:image" content="https://video.damplips.com/pics/a.jpg">
   </head><body>
     <video class="video-js"><source src="${file}" type="video/mp4"></video>
   </body></html>`;

describe("repairDirectUrls", () => {
  it("stores the file a post page publishes, and clears the embed it replaces", async () => {
    const service = fakeService([
      {
        id: "1",
        provider: "damplips",
        slug: "post-page-row",
        source_url: "https://www.damplips.com/p/65130/",
        playable_url: "https://www.damplips.com/p/65130/",
        embed_url: "https://www.damplips.com/p/65130/",
      },
    ]);
    const fetchPage = fetcher({
      "https://www.damplips.com/p/65130/": POST_PAGE("https://video.damplips.com/video7/709/02.mp4"),
    });

    const report = await repairDirectUrls(service, { fetchPage });

    expect(report.repaired).toBe(1);
    expect(report.unresolved).toBe(0);
    expect(service.updates[0]).toEqual({
      id: "1",
      values: { playable_url: "https://video.damplips.com/video7/709/02.mp4", embed_url: null },
    });
    expect(report.changes[0]).toMatchObject({
      slug: "post-page-row",
      to: "https://video.damplips.com/video7/709/02.mp4",
    });
  });

  it("rewrites a row that points at the stream proxy", async () => {
    const service = fakeService([
      {
        id: "2",
        provider: "damplips",
        slug: "proxy-row",
        source_url: "https://www.damplips.com/p/66907/",
        playable_url: `/api/videos/stream?src=${encodeURIComponent("https://www.damplips.com/p/66907/")}`,
        embed_url: null,
      },
    ]);
    const fetchPage = fetcher({
      "https://www.damplips.com/p/66907/": POST_PAGE("https://video.damplips.com/video7/716/31.mp4"),
    });

    const report = await repairDirectUrls(service, { fetchPage });

    expect(report.repaired).toBe(1);
    expect(service.updates[0].values.playable_url).toBe("https://video.damplips.com/video7/716/31.mp4");
  });

  it("never re-fetches a row that already holds a direct file", async () => {
    const service = fakeService([
      {
        id: "3",
        provider: "damplips",
        slug: "healthy-row",
        source_url: "https://www.damplips.com/p/67132/",
        playable_url: "https://video.damplips.com/video7/717/34.mp4",
        embed_url: null,
      },
    ]);
    const fetchPage = fetcher({});

    const report = await repairDirectUrls(service, { fetchPage });

    expect(report.healthy).toBe(1);
    expect(report.repaired).toBe(0);
    expect(fetchPage.calls).toEqual([]);
    expect(service.updates).toEqual([]);
  });

  it("reports a dry run without writing", async () => {
    const service = fakeService([
      {
        id: "4",
        provider: "damplips",
        slug: "dry-row",
        source_url: "https://www.damplips.com/p/67284/",
        playable_url: "https://www.damplips.com/p/67284/",
        embed_url: null,
      },
    ]);
    const fetchPage = fetcher({
      "https://www.damplips.com/p/67284/": POST_PAGE("https://video.damplips.com/video7/717/79.mp4"),
    });

    const report = await repairDirectUrls(service, { fetchPage, dryRun: true });

    expect(report.repaired).toBe(1);
    expect(report.dryRun).toBe(true);
    expect(service.updates).toEqual([]);
  });

  it("counts a page that publishes no file as unresolved", async () => {
    const service = fakeService([
      {
        id: "5",
        provider: "damplips",
        slug: "dead-row",
        source_url: "https://www.damplips.com/p/60000/",
        playable_url: null,
        embed_url: null,
      },
    ]);
    const fetchPage = fetcher({
      "https://www.damplips.com/p/60000/":
        '<html><head><meta property="og:title" content="A removed post headline"></head><body>gone</body></html>',
    });

    const report = await repairDirectUrls(service, { fetchPage });

    expect(report.unresolved).toBe(1);
    expect(report.repaired).toBe(0);
    expect(report.errors[0]).toMatch(/dead-row/);
    expect(service.updates).toEqual([]);
  });
});
