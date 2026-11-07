// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The nightly cron route imports one category until its search is exhausted,
 * inside a single invocation's time budget. It is authenticated with the same
 * Bearer `CRON_SECRET` as every other cron route.
 */

const state = vi.hoisted(() => ({
  service: null as any,
  slices: [] as any[],
  calls: [] as Array<{ cursor: any; pagesPerRequest: number }>,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createServiceClient: () => state.service };
});

vi.mock("@/lib/pornhub/importer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pornhub/importer")>();
  return {
    ...actual,
    importCategorySlice: async (options: any) => {
      state.calls.push({ cursor: options.cursor, pagesPerRequest: options.pagesPerRequest });
      return state.slices.shift();
    },
  };
});

vi.mock("@/lib/public/revalidate", () => ({ revalidatePublicTag: vi.fn() }));

function slice(overrides: Record<string, unknown> = {}) {
  return {
    category: "amateur",
    categoryId: "cat-amateur",
    imported: 10,
    duplicates: 1,
    skipped: { notHd: 0, unknownQuality: 0, short: 0, noThumbnail: 0, failed: 0 },
    pagesRead: 4,
    cursor: { source: 0, page: 5 },
    exhausted: false,
    dryRun: false,
    errors: [],
    samples: [],
    ...overrides,
  };
}

const service = {
  from: () => ({
    select: () => ({
      eq: () => ({
        limit: async () => ({
          data: [{ id: "cat-amateur", slug: "amateur", label: "Amateur" }],
          error: null,
        }),
      }),
    }),
  }),
};

function get(url: string, secret = "test-secret") {
  return new NextRequest(url, { headers: { authorization: `Bearer ${secret}` } });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  state.service = service;
  state.calls = [];
  state.slices = [];
});

describe("GET /api/cron/pornhub-import", () => {
  it("keeps asking for slices until the search is exhausted", async () => {
    state.slices = [
      slice({ imported: 10, cursor: { source: 0, page: 5 } }),
      slice({ imported: 6, cursor: { source: 0, page: 9 } }),
      slice({ imported: 0, duplicates: 40, cursor: { source: 2, page: 1 }, exhausted: true }),
    ];

    const { GET } = await import("@/app/api/cron/pornhub-import/route");
    const response = await GET(
      new NextRequest("http://localhost/api/cron/pornhub-import?category=amateur", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.report).toMatchObject({
      category: "amateur",
      imported: 16,
      duplicates: 42,
      pagesRead: 12,
      exhausted: true,
    });
    expect(state.calls).toHaveLength(3);
    // Each call resumes exactly where the previous one stopped.
    expect(state.calls[1].cursor).toEqual({ source: 0, page: 5 });
    expect(state.calls[2].cursor).toEqual({ source: 0, page: 9 });
  });

  it("stops when a slice reads nothing, instead of looping forever", async () => {
    state.slices = [slice({ imported: 0, pagesRead: 0, exhausted: false })];
    const { GET } = await import("@/app/api/cron/pornhub-import/route");
    const response = await GET(get("http://localhost/api/cron/pornhub-import?category=amateur"));
    expect(response.status).toBe(200);
    expect(state.calls).toHaveLength(1);
  });

  it("rejects a missing or unknown category", async () => {
    const { GET } = await import("@/app/api/cron/pornhub-import/route");
    const missing = await GET(get("http://localhost/api/cron/pornhub-import"));
    expect(missing.status).toBe(400);
    const unknown = await GET(
      get("http://localhost/api/cron/pornhub-import?category=knitting"),
    );
    expect(unknown.status).toBe(400);
  });

  it("requires the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/pornhub-import/route");
    const wrong = await GET(
      new NextRequest("http://localhost/api/cron/pornhub-import?category=amateur", {
        headers: { authorization: "Bearer nope" },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("answers 503 when the secret is not configured at all", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/pornhub-import/route");
    const response = await GET(
      new NextRequest("http://localhost/api/cron/pornhub-import?category=amateur"),
    );
    expect(response.status).toBe(503);
  });
});
