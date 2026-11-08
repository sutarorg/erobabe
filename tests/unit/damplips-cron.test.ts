// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createHarness } from "./helpers/video-route-harness";

/**
 * The nightly job is the unattended half of the importer: it must complete a
 * round of 100 new videos, keep whatever it imported when the site starts
 * refusing pages, and never run without its secret.
 */

const harnessState = vi.hoisted(() => ({ service: null as any }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createServiceClient: () => harnessState.service,
    isValidSupabaseUrl: () => true,
    isValidSupabaseKey: () => true,
    isSupabaseConfigured: () => true,
  };
});

const importCategorySlice = vi.hoisted(() => vi.fn());
vi.mock("@/lib/damplips/importer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/damplips/importer")>();
  return {
    ...actual,
    importCategorySlice: (...args: unknown[]) => importCategorySlice(...args),
  };
});

vi.mock("@/lib/damplips/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/damplips/client")>();
  return { ...actual, createDamplipsFetcher: () => vi.fn() };
});

vi.mock("@/lib/public/revalidate", () => ({ revalidatePublicTag: vi.fn() }));

import { GET } from "@/app/api/cron/damplips-import/route";

const HARDCORE = { id: "cat-hardcore", label: "Hardcore", slug: "hardcore" };

function request(path: string, secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new NextRequest(`https://erobabe.test${path}`, { headers });
}

function slice(overrides: Record<string, unknown> = {}) {
  return {
    category: "hardcore",
    categoryId: "cat-hardcore",
    target: 100,
    targetReached: false,
    uncategorised: 0,
    imported: 3,
    duplicates: 1,
    repaired: 0,
    skipped: { missingMedia: 0, missingThumbnail: 0, short: 0, failed: 0 },
    pagesRead: 2,
    postsRead: 5,
    cursor: { source: 1, page: 2, skip: 0 },
    exhausted: false,
    dryRun: false,
    errors: [],
    sources: [],
    samples: [],
    ...overrides,
  };
}

describe("GET /api/cron/damplips-import", () => {
  beforeEach(() => {
    importCategorySlice.mockReset();
    const harness = createHarness({ videos: [], categories: [HARDCORE] });
    harnessState.service = harness.service;
    vi.stubEnv("CRON_SECRET", "nightly-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loops short slices until the round of 100 is complete", async () => {
    importCategorySlice
      .mockResolvedValueOnce(slice({ imported: 40, cursor: { source: 1, page: 2, skip: 0 } }))
      .mockResolvedValueOnce(slice({ imported: 30, cursor: { source: 4, page: 1, skip: 1 } }))
      .mockResolvedValueOnce(
        slice({ imported: 30, targetReached: true, cursor: { source: 4, page: 2, skip: 0 } }),
      );

    const response = await GET(request("/api/cron/damplips-import?category=hardcore", "nightly-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report).toMatchObject({
      imported: 100,
      target: 100,
      targetReached: true,
      exhausted: false,
    });

    // Each call asks for what the round still needs, from the cursor the
    // previous call returned.
    const targets = importCategorySlice.mock.calls.map((call) => call[0].importTarget);
    expect(targets).toEqual([100, 60, 30]);
    const cursors = importCategorySlice.mock.calls.map((call) => call[0].cursor);
    expect(cursors[0]).toEqual({ source: 0, page: 1, skip: 0 });
    expect(cursors[1]).toEqual({ source: 1, page: 2, skip: 0 });
    expect(cursors[2]).toEqual({ source: 4, page: 1, skip: 1 });
    // The first slice also repairs stored posters.
    expect(importCategorySlice.mock.calls[0][0].repair).toBe(true);
    expect(importCategorySlice.mock.calls[0][1].categoryId).toBe("cat-hardcore");
  });

  it("stops and reports when the category's listings are all walked", async () => {
    importCategorySlice
      .mockResolvedValueOnce(slice({ imported: 3, cursor: { source: 1, page: 2, skip: 0 } }))
      .mockResolvedValueOnce(slice({ imported: 2, cursor: { source: 4, page: 1, skip: 1 } }))
      .mockResolvedValueOnce(
        slice({ imported: 0, pagesRead: 1, postsRead: 0, exhausted: true, cursor: { source: 9, page: 1, skip: 0 } }),
      );

    const response = await GET(request("/api/cron/damplips-import?category=hardcore", "nightly-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report).toMatchObject({ imported: 5, exhausted: true, targetReached: false });

    // The cursor of each call is the one the previous call returned.
    const cursors = importCategorySlice.mock.calls.map((call) => call[0].cursor);
    expect(cursors[0]).toEqual({ source: 0, page: 1, skip: 0 });
    expect(cursors[1]).toEqual({ source: 1, page: 2, skip: 0 });
    expect(cursors[2]).toEqual({ source: 4, page: 1, skip: 1 });
    // Every category's first slice also repairs stored posters.
    expect(importCategorySlice.mock.calls[0][0].repair).toBe(true);
    expect(importCategorySlice.mock.calls[0][1].categoryId).toBe("cat-hardcore");
  });

  it("stops instead of spinning when a slice can read nothing", async () => {
    importCategorySlice.mockResolvedValue(slice({ imported: 0, pagesRead: 0, postsRead: 0 }));
    const response = await GET(request("/api/cron/damplips-import?category=hardcore", "nightly-secret"));
    expect(response.status).toBe(200);
    expect(importCategorySlice).toHaveBeenCalledTimes(1);
  });

  it("refuses a missing or wrong secret, and an unknown category", async () => {
    expect((await GET(request("/api/cron/damplips-import?category=hardcore"))).status).toBe(401);
    expect((await GET(request("/api/cron/damplips-import?category=hardcore", "wrong"))).status).toBe(401);
    expect(
      (await GET(request("/api/cron/damplips-import?category=not-a-category", "nightly-secret"))).status,
    ).toBe(400);
    expect(importCategorySlice).not.toHaveBeenCalled();
  });

  it("answers 503 when no secret is configured at all", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("/api/cron/damplips-import?category=hardcore"))).status).toBe(503);
    expect(importCategorySlice).not.toHaveBeenCalled();
  });
});
