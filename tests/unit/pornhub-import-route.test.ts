// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `/api/admin/pornhub/import` is the only way the dashboard can write catalog
 * rows, so it is admin-only, it validates the category, and it never accepts a
 * "how many" or a target from the client — the import is unlimited by design.
 */

const state = vi.hoisted(() => ({
  service: null as any,
  auth: null as any,
  calls: [] as Array<{ options: any; deps: any }>,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createClient: async () => state.auth,
    createServiceClient: () => state.service,
    isValidSupabaseUrl: () => true,
    isValidSupabaseKey: () => true,
    isSupabaseConfigured: () => true,
  };
});

vi.mock("@/lib/pornhub/importer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pornhub/importer")>();
  return {
    ...actual,
    importCategorySlice: async (options: any, deps: any) => {
      state.calls.push({ options, deps });
      return {
        category: options.categorySlug,
        categoryId: "cat-amateur",
        imported: 7,
        duplicates: 2,
        skipped: { notHd: 0, unknownQuality: 0, short: 0, noThumbnail: 0, failed: 0 },
        pagesRead: 4,
        cursor: { source: 0, page: 5 },
        exhausted: false,
        dryRun: Boolean(options.dryRun),
        errors: [],
        samples: [],
      };
    },
  };
});

vi.mock("@/lib/public/revalidate", () => ({ revalidatePublicTag: vi.fn() }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

function adminService() {
  return {
    from(table: string) {
      if (table === "categories") {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              limit: async () => ({
                data:
                  value === "amateur"
                    ? [{ id: "cat-amateur", slug: "amateur", label: "Amateur" }]
                    : [],
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function signedIn(role = "admin", status = "active") {
  const profile = { role, status };
  return {
    auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: profile, error: null }),
        }),
      }),
    }),
  };
}

function request(body: unknown, method = "POST") {
  return new NextRequest("http://localhost/api/admin/pornhub/import", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  state.calls = [];
  state.service = adminService();
  state.auth = signedIn();
});

describe("POST /api/admin/pornhub/import", () => {
  it("imports one category slice for an active admin", async () => {
    const { POST } = await import("@/app/api/admin/pornhub/import/route");
    const response = await POST(
      request({ category: "amateur", cursor: { source: 1, page: 9 }, pages: 6 }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.report).toMatchObject({
      category: "amateur",
      label: "Amateur",
      imported: 7,
      pagesRead: 4,
    });

    const call = state.calls[0];
    expect(call.options).toMatchObject({
      categorySlug: "amateur",
      cursor: { source: 1, page: 9 },
      pagesPerRequest: 6,
      dryRun: false,
      rightsStatus: "cleared",
    });
    expect(call.deps.categoryId).toBe("cat-amateur");
  });

  it("accepts no video target from the client", async () => {
    const { POST } = await import("@/app/api/admin/pornhub/import/route");
    // A client can say how many *pages* this request may read, never how many
    // videos to import, and never "stop after N".
    await POST(request({ category: "amateur", perCategory: 5, target: 5, limit: 5 }));
    expect(state.calls[0].options).not.toHaveProperty("perCategory");
    expect(state.calls[0].options).not.toHaveProperty("target");
    expect(state.calls[0].options).not.toHaveProperty("limit");
  });

  it("rejects a category that has no configured source", async () => {
    const { POST } = await import("@/app/api/admin/pornhub/import/route");
    const response = await POST(request({ category: "knitting" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("No Pornhub source");
    expect(state.calls).toHaveLength(0);
  });

  it("rejects a malformed category instead of passing it to the importer", async () => {
    const { POST } = await import("@/app/api/admin/pornhub/import/route");
    const response = await POST(request({ category: "../../etc/passwd" }));
    expect(response.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("refuses an anonymous request", async () => {
    state.auth = { auth: { getUser: async () => ({ data: { user: null } }) } };
    const { POST } = await import("@/app/api/admin/pornhub/import/route");
    const response = await POST(request({ category: "amateur" }));
    expect(response.status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it("refuses a signed-in visitor who is not an admin", async () => {
    state.auth = signedIn("user", "active");
    const { POST } = await import("@/app/api/admin/pornhub/import/route");
    const response = await POST(request({ category: "amateur" }));
    expect(response.status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });

  it("clamps an enormous page budget to the importer's ceiling", async () => {
    const { POST } = await import("@/app/api/admin/pornhub/import/route");
    const { MAX_PAGES_PER_REQUEST } = await import("@/lib/pornhub/importer");
    await POST(request({ category: "amateur", pages: 99_999 }));
    expect(state.calls[0].options.pagesPerRequest).toBe(MAX_PAGES_PER_REQUEST);
  });
});
