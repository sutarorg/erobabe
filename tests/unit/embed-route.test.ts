import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHarness, jsonRequest, ADMIN_ID, CATEGORY_ID } from "./helpers/video-route-harness";
import type { FakeDb } from "./helpers/fake-supabase";

/**
 * Tests for the embed publishing route (/api/videos/embed).
 *
 * Covers embedding with browser-prepared metadata, the deterministic
 * fallback, server-side re-validation of untrusted metadata, authorization,
 * tag/record persistence — and the guarantee that the backend never issues a
 * Gemini or OpenRouter inference request (global fetch spy stays empty).
 */

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

const harnessState = vi.hoisted(() => ({
  service: null as any,
  auth: null as any,
}));

import { POST } from "@/app/api/videos/embed/route";

const fetchSpy = vi.fn();

function preparedMetadata(overrides: Record<string, unknown> = {}) {
  return {
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    source: "ai",
    ...overrides,
  };
}

function setupHarness(overrides: Partial<FakeDb> = {}) {
  const harness = createHarness(overrides);
  harnessState.service = harness.service;
  harnessState.auth = harness.auth;
  return harness;
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  setupHarness();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/videos/embed — authorization", () => {
  it("rejects unauthenticated requests", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: harnessState.service.from,
    };
    const req = jsonRequest("/api/videos/embed", {
      categoryId: CATEGORY_ID,
      entries: [{ source: "https://streamtape.com/e/m9XLJGmaJOcbPr2", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-admin users", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: { id: "non-admin" } } }) },
      from: harnessState.service.from,
    };
    const req = jsonRequest("/api/videos/embed", {
      categoryId: CATEGORY_ID,
      entries: [{ source: "https://streamtape.com/e/m9XLJGmaJOcbPr2", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/videos/embed — publishing with prepared metadata", () => {
  it("publishes an embed with browser-prepared metadata and persists tags", async () => {
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/embed", {
      categoryId: CATEGORY_ID,
      entries: [{ source: "https://streamtape.com/e/m9XLJGmaJOcbPr2", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBe(1);

    const result = body.results[0];
    expect(result.status).toBe("published");
    expect(result.title).toBe("Evening in Velvet");
    expect(result.metadataSource).toBe("ai");
    expect(result.source).toBe("https://streamtape.com/e/m9XLJGmaJOcbPr2");

    const video = harness.db.videos.find((entry: any) => entry.id === result.videoId)!;
    expect(video.provider).toBe("embed");
    expect(video.embed_url).toBe("https://streamtape.com/e/m9XLJGmaJOcbPr2");
    expect(video.playable_url).toBeNull();
    expect(video.status).toBe("published");
    expect(video.visibility).toBe("public");
    expect(video.title).toBe("Evening in Velvet");
    expect(video.description).toContain("cinematic light");

    const links = harness.db.video_tags.filter((entry: any) => entry.video_id === result.videoId);
    expect(links).toHaveLength(3);

    const auditRow = harness.db.audit_logs.find((row: any) => row.action === "video_published_from_embed")!;
    expect(auditRow).toBeTruthy();
    expect(auditRow.actor_id).toBe(ADMIN_ID);
    expect(auditRow.metadata.provider).toBe("embed");

    // The backend never performs a second inference request.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses deterministic file-name metadata when the client sends none", async () => {
    const req = jsonRequest("/api/videos/embed", {
      categoryId: CATEGORY_ID,
      entries: [{ source: "https://streamtape.com/e/m9XLJGmaJOcbPr2" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].metadataSource).toBe("fallback");
    expect(body.results[0].metadataWarning).toMatch(/AI metadata unavailable/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-validates malformed prepared metadata server-side and falls back", async () => {
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/embed", {
      categoryId: CATEGORY_ID,
      entries: [
        {
          source: "https://streamtape.com/e/m9XLJGmaJOcbPr2",
          metadata: { title: "", description: 42, tags: "nope", source: "ai" },
        },
      ],
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].metadataSource).toBe("fallback");

    const video = harness.db.videos.find((entry: any) => entry.id === body.results[0].videoId)!;
    expect(video.title.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails the entry when the source is not a usable embed URL", async () => {
    const req = jsonRequest("/api/videos/embed", {
      categoryId: CATEGORY_ID,
      entries: [{ source: "not a url at all", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.results[0].status).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never returns secrets in the response", async () => {
    const req = jsonRequest("/api/videos/embed", {
      categoryId: CATEGORY_ID,
      entries: [{ source: "https://streamtape.com/e/m9XLJGmaJOcbPr2", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/SUPABASE|SECRET|OPENROUTER|API_KEY/i);
  });
});
