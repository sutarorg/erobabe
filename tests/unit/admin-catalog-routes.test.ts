import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHarness, jsonRequest, multipartRequest, ADMIN_ID } from "./helpers/video-route-harness";
import type { FakeDb } from "./helpers/fake-supabase";

/**
 * Tests for the two routes the retired upload pipeline left behind:
 *
 * - `/api/admin/uploads/thumbnail` — the only upload target the app still
 *   issues, and images only.
 * - `/api/admin/damplips/import` — admin-triggered catalog fill.
 *
 * Both are admin-only, and the video importer never receives an upload.
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

import { POST as uploadThumbnail } from "@/app/api/admin/uploads/thumbnail/route";
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

describe("POST /api/admin/uploads/thumbnail", () => {
  it("issues a signed image upload for the signed-in admin", async () => {
    const response = await uploadThumbnail(
      jsonRequest("/api/admin/uploads/thumbnail", {
        kind: "thumbnail",
        fileName: "card.jpg",
        fileSize: 1024,
        mimeType: "image/jpeg",
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe("thumbnail");
    expect(body.uploadUrl).toContain("signed://");
    expect(body.storagePath.startsWith(`${ADMIN_ID}/`)).toBe(true);
    expect(body.publicUrl).toContain("video-thumbnails");
  });

  it("refuses video uploads", async () => {
    const asVideoKind = await uploadThumbnail(
      jsonRequest("/api/admin/uploads/thumbnail", {
        kind: "video",
        fileName: "clip.mp4",
        fileSize: 1024,
        mimeType: "video/mp4",
      }),
    );
    expect(asVideoKind.status).toBe(400);

    const asVideoMime = await uploadThumbnail(
      jsonRequest("/api/admin/uploads/thumbnail", {
        kind: "thumbnail",
        fileName: "clip.mp4",
        fileSize: 1024,
        mimeType: "video/mp4",
      }),
    );
    expect(asVideoMime.status).toBe(415);
    expect((await asVideoMime.json()).error).toMatch(/only images/i);
  });

  it("refuses a multipart body instead of accepting bytes", async () => {
    const response = await uploadThumbnail(multipartRequest("/api/admin/uploads/thumbnail"));
    expect(response.status).toBe(415);
  });

  it("validates the requested metadata", async () => {
    const noName = await uploadThumbnail(
      jsonRequest("/api/admin/uploads/thumbnail", { fileName: "", fileSize: 10, mimeType: "image/png" }),
    );
    expect(noName.status).toBe(400);

    const tooLarge = await uploadThumbnail(
      jsonRequest("/api/admin/uploads/thumbnail", {
        fileName: "huge.jpg",
        fileSize: 11 * 1024 * 1024,
        mimeType: "image/jpeg",
      }),
    );
    expect(tooLarge.status).toBeGreaterThanOrEqual(400);
    expect((await tooLarge.json()).error).toMatch(/10 MB/);
  });

  it("rejects a request with no admin session", async () => {
    harnessState.auth = { auth: { getUser: async () => ({ data: { user: null } }) }, from: harnessState.auth.from };
    const response = await uploadThumbnail(
      jsonRequest("/api/admin/uploads/thumbnail", {
        fileName: "card.jpg",
        fileSize: 1024,
        mimeType: "image/jpeg",
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(401);
  });
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
