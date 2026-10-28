import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHarness } from "./helpers/video-route-harness";

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

const importCategory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/damplips/importer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/damplips/importer")>();
  return {
    ...actual,
    importCategory: (...args: unknown[]) => importCategory(...args),
  };
});

vi.mock("@/lib/damplips/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/damplips/client")>();
  return { ...actual, createDamplipsFetcher: () => vi.fn() };
});

vi.mock("@/lib/public/revalidate", () => ({ revalidatePublicTag: vi.fn() }));

import { GET } from "@/app/api/cron/damplips-import/route";
import { AUTOPILOT_VIDEOS_PER_CATEGORY } from "@/lib/damplips/importer";
import { NextRequest } from "next/server";

const HARDCORE = { id: "cat-hardcore", label: "Hardcore", slug: "hardcore" };

function request(path: string, secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new NextRequest(`https://erobabe.test${path}`, { headers });
}

describe("GET /api/cron/damplips-import", () => {
  beforeEach(() => {
    importCategory.mockReset();
    const harness = createHarness({ videos: [], categories: [HARDCORE] });
    harnessState.service = harness.service;
    vi.stubEnv("CRON_SECRET", "nightly-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("imports 100 unique videos for the requested category when authorized", async () => {
    importCategory.mockResolvedValueOnce({
      imported: 100,
      updated: 0,
      fulfilled: true,
    });
    const response = await GET(request("/api/cron/damplips-import?category=hardcore", "nightly-secret"));
    expect(response.status).toBe(200);
    const [options, deps] = importCategory.mock.calls[0];
    expect(options).toMatchObject({
      categorySlug: "hardcore",
      perCategory: AUTOPILOT_VIDEOS_PER_CATEGORY,
    });
    expect(options.perCategory).toBe(100);
    expect(deps.categoryId).toBe("cat-hardcore");
  });

  it("refuses a missing or wrong secret", async () => {
    expect((await GET(request("/api/cron/damplips-import?category=hardcore"))).status).toBe(401);
    expect(
      (await GET(request("/api/cron/damplips-import?category=hardcore", "wrong"))).status,
    ).toBe(401);
    expect(importCategory).not.toHaveBeenCalled();
  });
});
