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

const importCategory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/damplips/importer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/damplips/importer")>();
  return {
    ...actual,
    importCategory: (...args: unknown[]) => importCategory(...args),
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
  importCategory.mockReset();
  setup();
});

describe("POST /api/admin/damplips/import", () => {
  it("imports one category and returns the report", async () => {
    importCategory.mockResolvedValueOnce({
      category: "hardcore",
      categoryId: "cat-boudoir",
      target: 100,
      minimum: 100,
      imported: 100,
      updated: 0,
      alreadyPresent: 0,
      skipped: { duplicateAcrossCategories: 0, missingMedia: 0, missingThumbnail: 0, failed: 0 },
      total: 100,
      fulfilled: true,
      dryRun: false,
      sources: [],
      errors: [],
      samples: [],
    });

    const response = await importDamplips(
      jsonRequest("/api/admin/damplips/import", { category: "hardcore", perCategory: 100 }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report.total).toBe(100);
    expect(body.report.fulfilled).toBe(true);

    const [options, deps] = importCategory.mock.calls[0];
    expect(options).toMatchObject({ categorySlug: "hardcore", perCategory: 100, dryRun: false, rightsStatus: "cleared" });
    expect(deps.categoryId).toBe("cat-hardcore");
    expect(typeof deps.fetchPage).toBe("function");
  });

  it("passes pending rights through and never fetches during a validation error", async () => {
    importCategory.mockResolvedValueOnce({ total: 0, fulfilled: false, imported: 0, updated: 0 });
    const response = await importDamplips(
      jsonRequest("/api/admin/damplips/import", { category: "hardcore", rightsStatus: "pending" }),
    );
    expect(response.status).toBe(200);
    expect(importCategory.mock.calls[0][0].rightsStatus).toBe("pending");
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
    expect(importCategory).not.toHaveBeenCalled();
  });

  it("rejects a request with no admin session", async () => {
    harnessState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harnessState.auth.from };
    const response = await importDamplips(
      jsonRequest("/api/admin/damplips/import", { category: "hardcore" }),
    );
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(importCategory).not.toHaveBeenCalled();
  });
});
