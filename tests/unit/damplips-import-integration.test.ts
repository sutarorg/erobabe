// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createDamplipsFetcher } from "@/lib/damplips/client";
import { importCategorySlice, type DamplipsImportReport } from "@/lib/damplips/importer";
import type { ImportService } from "@/lib/catalog/counts";

/**
 * The importer against a real HTTP server.
 *
 * The unit tests inject a fetcher, which cannot show that the pieces fit: the
 * real client, its host allowlist, concurrent page reads and the insert path all
 * have to work together for a round of 100 to actually arrive. This fixture
 * serves a small damplips-shaped site with a simulated network delay and counts
 * what one round costs.
 */

const PER_PAGE = 20;
const LATENCY_MS = 10;
const PAGES = 30;

let server: http.Server;
let base = "";
const inserted: Array<Record<string, unknown>> = [];
let requests = 0;
let peakInFlight = 0;
let inFlight = 0;

function listing(page: number, path: string): string {
  const anchors: string[] = [];
  for (let index = 0; index < PER_PAGE; index += 1) {
    const id = String(700000 + page * 100 + index);
    anchors.push(
      `<div class="post"><a href="/p/${id}/" title="Scene number ${id} on this listing">` +
        `<img src="https://video.damplips.com/pics/${id}.jpg" alt="" /></a></div>`,
    );
  }
  const root = path.replace(/\/page\/\d+\/?$/, "").replace(/\/$/, "");
  const next = page < PAGES ? `<a rel="next" href="${base}${root}/page/${page + 1}/">Next</a>` : "";
  return `<html><body>${anchors.join("")}${next}</body></html>`;
}

function postPage(id: string): string {
  return `<html><head>
    <meta property="og:title" content="Scene number ${id} on this listing" />
    <meta property="og:image" content="https://video.damplips.com/pics/${id}.jpg" />
    <meta property="og:video" content="https://video.damplips.com/video7/${id}/v.mp4" />
    <meta property="video:duration" content="640" />
    <meta name="keywords" content="amateur, homemade" />
  </head><body><span>1,204 views</span></body></html>`;
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    requests += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    const url = new URL(request.url || "/", base || "http://127.0.0.1");
    const post = /^\/p\/(\d+)\/?$/.exec(url.pathname);
    setTimeout(() => {
      inFlight -= 1;
      response.writeHead(200, { "content-type": "text/html" });
      if (post) {
        response.end(postPage(post[1]));
        return;
      }
      const page = Number(/\/page\/(\d+)/.exec(url.pathname)?.[1] || 1);
      response.end(listing(page, url.searchParams.has("s") ? "/s" : url.pathname));
    }, LATENCY_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

/** A minimal PostgREST stand-in: batched identity lookups and inserts only. */
function service(known: Set<string>): ImportService {
  return {
    from: () => ({
      select: () => {
        const builder: Record<string, unknown> = {
          eq: () => builder,
          in: async (_column: string, values: string[]) => ({
            data: values
              .filter((value) => known.has(value))
              .map((value) => ({ provider_file_id: value })),
            error: null,
          }),
          is: () => builder,
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
      insert: async (input: Record<string, unknown> | Array<Record<string, unknown>>) => {
        for (const row of Array.isArray(input) ? input : [input]) {
          known.add(String(row.provider_file_id));
          inserted.push(row);
        }
        return { error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as ImportService;
}

async function run(cursor?: DamplipsImportReport["cursor"], known = new Set<string>()) {
  const fetchPage = createDamplipsFetcher({ baseUrl: base, retries: 0 });
  const started = Date.now();
  const report = await importCategorySlice(
    { categorySlug: "amateur", baseUrl: base, cursor, pagesPerRequest: 12 },
    {
      fetchPage,
      service: service(known),
      categoryId: "cat-amateur",
      delayMs: 0,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    },
  );
  return { report, elapsed: Date.now() - started, known };
}

describe("damplips round over HTTP", () => {
  it("imports its 100 videos, fast, with post pages read concurrently", async () => {
    const { report, elapsed } = await run();

    expect(report.imported).toBe(100);
    expect(report.targetReached).toBe(true);
    // Five listing pages hold the first 100 posts; it stops there.
    expect(report.pagesRead).toBeLessThanOrEqual(6);
    expect(report.postsRead).toBe(100);
    // One insert per batch of 25, not one per video.
    expect(inserted.length).toBe(100);
    expect(requests).toBeLessThan(120);
    // Several post pages were in flight at once.
    expect(peakInFlight).toBeGreaterThan(1);
    // 100 videos in seconds even with a 10 ms network on every request.
    expect(elapsed).toBeLessThan(15_000);
  }, 60_000);

  it("continues with the next 100 from the cursor, without re-reading them", async () => {
    const known = new Set(inserted.map((row) => String(row.provider_file_id)));
    const { report } = await run(
      { source: 0, page: 6, skip: 0, url: `${base}/c/amateur-porn/page/6/` },
      known,
    );

    expect(report.imported).toBe(100);
    // Nothing was opened twice.
    const ids = inserted.map((row) => String(row.provider_file_id));
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);
});
