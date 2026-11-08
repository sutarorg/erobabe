import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHarness, jsonRequest } from "./helpers/video-route-harness";
import type { FakeDb } from "./helpers/fake-supabase";

/**
 * Tests for `/api/admin/damplips/import` — the admin-triggered catalog fill.
 *
 * The retired upload pipeline's `/api/admin/uploads/thumbnail` route is gone,
 * so only the importer route is covered here. It is admin-only, and it never
 * receives an upload.
 */

const harnessState = vi.hoisted(() => ({ service: null as any, auth: null as any }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createClient: async () => harnessState.auth,
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

const fetchPage = vi.hoisted(() =>
  vi.fn(async (url: string) => ({
    url,
    status: 200,
    html: '<html><head><meta property="og:title" content="A damplips post"><meta property="og:image" content="https://video.damplips.com/p/poster.jpg"><meta property="og:video" content="https://video.damplips.com/v/1.mp4"></head></html>',
  })),
);
vi.mock("@/lib/damplips/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/damplips/client")>();
  return { ...actual, createDamplipsFetcher: () => fetchPage };
});

vi.mock("@/lib/public/revalidate", () => ({ revalidatePublicTag: vi.fn() }));

import { POST as importDamplips } from "@/app/api/admin/damplips/import/route";

const HARDCORE = { id: "cat-hardcore", label: "Hardcore", slug: "hardcore" };

function setup(overrides: Partial<FakeDb> = {}) {
  const harness = createHarness({ videos: [], categories: [HARDCORE], ...overrides });
  harnessState.service = harness.service;
  harnessState.auth = harness.auth;
  return harness;
}

beforeEach(() => {
  importCategorySlice.mockReset();
  setup();
});

describe("POST /api/admin/damplips/import", () => {
  it("imports one slice of one category and returns its report", async () => {
    importCategorySlice.mockResolvedValueOnce({
      category: "hardcore",
      categoryId: "cat-hardcore",
      imported: 12,
      duplicates: 3,
      repaired: 0,
      skipped: { missingMedia: 0, missingThumbnail: 0, short: 0, failed: 0 },
      pagesRead: 2,
      postsRead: 15,
      cursor: { source: 1, page: 2, skip: 0 },
      exhausted: false,
      dryRun: false,
      errors: [],
      sources: [],
      samples: [],
    });

    const response = await importDamplips(
      jsonRequest("/api/admin/damplips/import", { category: "hardcore" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report).toMatchObject({ imported: 12, pagesRead: 2, label: "Hardcore" });

    const [options, deps] = importCategorySlice.mock.calls[0];
    expect(options).toMatchObject({ categorySlug: "hardcore", dryRun: false, rightsStatus: "cleared" });
    // No "how many videos" is accepted, or even looked at.
    expect(options).not.toHaveProperty("perCategory");
    expect(options).not.toHaveProperty("limit");
    expect(deps.categoryId).toBe("cat-hardcore");
    expect(typeof deps.fetchPage).toBe("function");
  });

  it("passes the cursor, the slice budget and pending rights through", async () => {
    importCategorySlice.mockResolvedValueOnce({ imported: 0, pagesRead: 0, postsRead: 0, exhausted: false });

    const response = await importDamplips(
      jsonRequest("/api/admin/damplips/import", {
        category: "hardcore",
        cursor: { source: 2, page: 3, skip: 4, url: "https://www.damplips.com/c/hardcore/page/3/" },
        pages: 2,
        posts: 6,
        repair: true,
        rightsStatus: "pending",
      }),
    );

    expect(response.status).toBe(200);
    const [options] = importCategorySlice.mock.calls[0];
    expect(options).toMatchObject({
      cursor: { source: 2, page: 3, skip: 4, url: "https://www.damplips.com/c/hardcore/page/3/" },
      pagesPerRequest: 2,
      postsPerRequest: 6,
      repair: true,
      rightsStatus: "pending",
    });
  });

  it("clamps a nonsense round budget instead of trusting the caller", async () => {
    importCategorySlice.mockResolvedValueOnce({ imported: 0, pagesRead: 0, postsRead: 0, exhausted: false });
    await importDamplips(
      jsonRequest("/api/admin/damplips/import", {
        category: "hardcore",
        pages: 10_000,
        posts: -4,
        target: 10_000,
      }),
    );
    const [options] = importCategorySlice.mock.calls[0];
    expect(options.pagesPerRequest).toBeLessThanOrEqual(60);
    expect(options.postsPerRequest).toBeGreaterThan(0);
    // A round of 100 is the default; nobody can ask for thousands at once.
    expect(options.importTarget).toBe(400);
  });

  it("asks for a round of 100 new videos by default", async () => {
    importCategorySlice.mockResolvedValueOnce({ imported: 100, pagesRead: 5, postsRead: 100 });
    const response = await importDamplips(
      jsonRequest("/api/admin/damplips/import", { category: "hardcore" }),
    );
    expect(response.status).toBe(200);
    expect(importCategorySlice.mock.calls[0][0].importTarget).toBe(100);
    // The round is what the caller asked the importer for, not a page budget.
    expect(importCategorySlice.mock.calls[0][0]).not.toHaveProperty("perCategory");
  });

  it("rejects unknown and malformed categories", async () => {
    const unknown = await importDamplips(
      jsonRequest("/api/admin/damplips/import", { category: "not-a-category" }),
    );
    expect(unknown.status).toBe(400);

    const malformed = await importDamplips(
      jsonRequest("/api/admin/damplips/import", { category: "hardcore'); drop table videos;--" }),
    );
    expect(malformed.status).toBe(400);

    const empty = await importDamplips(jsonRequest("/api/admin/damplips/import", {}));
    expect(empty.status).toBe(400);
    expect(importCategorySlice).not.toHaveBeenCalled();
  });

  it("rejects a request with no admin session", async () => {
    harnessState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harnessState.auth.from };
    const response = await importDamplips(
      jsonRequest("/api/admin/damplips/import", { category: "hardcore" }),
    );
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(importCategorySlice).not.toHaveBeenCalled();
  });
});
