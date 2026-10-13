import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHarness, jsonRequest, ADMIN_ID, CATEGORY_ID } from "./helpers/video-route-harness";
import type { FakeDb } from "./helpers/fake-supabase";

/**
 * Tests for the direct-URL publishing route (/api/videos/upload-url).
 *
 * The route validates URLs, re-validates browser-prepared metadata, creates
 * video records with `provider = 'direct_url'`, stores the URL in
 * `playable_url`, and publishes immediately. The backend never calls Gemini,
 * OpenRouter, or any other AI provider — verified here with a global fetch
 * spy. No hosting-provider API or relay is used either.
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

import { POST } from "@/app/api/videos/upload-url/route";

const fetchSpy = vi.fn();

/** Browser-prepared AI metadata, as the admin upload page sends it. */
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

describe("POST /api/videos/upload-url — authorization", () => {
  it("rejects unauthenticated requests", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: harnessState.service.from,
    };
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/v.mp4", metadata: preparedMetadata() }],
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
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/v.mp4", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects inactive admins", async () => {
    const harness = setupHarness({
      profiles: [{ id: ADMIN_ID, role: "admin", status: "suspended" }],
    });
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID } } }) },
      from: harness.service.from,
    };
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/v.mp4" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/videos/upload-url — URL validation", () => {
  it("rejects missing category", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: "",
      entries: [{ url: "https://cdn.example.com/v.mp4" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/category/i);
  });

  it("rejects empty entries", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least one/i);
  });

  it("rejects non-HTTPS URLs", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "ftp://cdn.example.com/v.mp4" }],
    });
    const res = await POST(req);
    // All entries failed validation → 400.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No valid video URLs/);
  });

  it("rejects URLs without a video extension", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/video" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No valid video URLs/);
  });

  it("accepts URLs with query strings on valid MP4 paths", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/video.mp4?token=abc123", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBe(1);
    expect(body.results[0].status).toBe("published");
  });

  it("accepts uppercase MP4 extension", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/video.MP4" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBe(1);
  });

  it("rejects URLs with embedded credentials", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://user:pass@cdn.example.com/v.mp4" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No valid video URLs/);
  });

  it("rejects localhost URLs", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://localhost/v.mp4" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No valid video URLs/);
  });

  it("rejects private IP addresses", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://192.168.1.1/v.mp4" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No valid video URLs/);
  });

  it("deduplicates URLs in a batch", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [
        { url: "https://cdn.example.com/v.mp4", metadata: preparedMetadata() },
        { url: "https://cdn.example.com/v.mp4", metadata: preparedMetadata() },
      ],
    });
    const res = await POST(req);
    // One published + one duplicate-failed = 207 (partial success).
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.succeeded).toBe(1);
    expect(body.results).toHaveLength(2);
    expect(body.results[1].status).toBe("failed");
    expect(body.results[1].error).toMatch(/duplicate/i);
  });

  it("rejects batches that exceed the size limit", async () => {
    const entries = Array.from({ length: 21 }, (_, i) => ({
      url: `https://cdn.example.com/v${i}.mp4`,
    }));
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries,
    });
    const res = await POST(req);
    // The route validates the raw entry count before URL validation.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/20/);
  });
});

describe("POST /api/videos/upload-url — publishing with prepared metadata", () => {
  it("publishes a direct URL with browser-prepared metadata and no backend AI call", async () => {
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);

    const result = body.results[0];
    expect(result.status).toBe("published");
    expect(result.title).toBe("Evening in Velvet");
    expect(result.slug).toBeTruthy();
    expect(result.videoId).toBeTruthy();
    expect(result.metadataSource).toBe("ai");

    // Metadata and tags persisted to the database.
    const video = harness.db.videos.find((entry: any) => entry.id === result.videoId)!;
    expect(video.title).toBe("Evening in Velvet");
    expect(video.description).toContain("cinematic light");
    const links = harness.db.video_tags.filter((entry: any) => entry.video_id === result.videoId);
    expect(links.length).toBe(3);

    // No second inference request happens on the server.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stores the direct URL in playable_url and embed_url as null", async () => {
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://video.damplips.com/video7/717/70.mp4", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.succeeded).toBe(1);
    expect(body.results[0].status).toBe("published");

    // Verify the stored video.
    const video = harness.db.videos.find((v: any) => v.id === body.results[0].videoId)!;
    expect(video).toBeTruthy();
    expect(video.provider).toBe("direct_url");
    expect(video.playable_url).toBe("https://video.damplips.com/video7/717/70.mp4");
    expect(video.embed_url).toBeNull();
    expect(video.status).toBe("published");
    expect(video.visibility).toBe("public");
  });

  it("uses deterministic file-name metadata when the client sends none", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/evening_in_velvet_4k.mp4" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.succeeded).toBe(1);
    expect(body.results[0].metadataSource).toBe("fallback");
    expect(body.results[0].metadataWarning).toMatch(/AI metadata unavailable/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-validates malformed prepared metadata server-side and falls back", async () => {
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [
        {
          url: "https://cdn.example.com/evening_in_velvet_4k.mp4",
          metadata: { title: "x", description: "", tags: [], source: "definitely-not-ai" },
        },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].metadataSource).toBe("fallback");

    // The malformed payload never reached the database.
    const video = harness.db.videos.find((entry: any) => entry.id === body.results[0].videoId)!;
    expect(video.title).toBe("Evening In Velvet 4k");
    expect(video.title).not.toBe("x");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clamps an over-long prepared title instead of writing it raw", async () => {
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [
        {
          url: "https://cdn.example.com/clip.mp4",
          metadata: preparedMetadata({ title: "a".repeat(500) }),
        },
      ],
    });
    const res = await POST(req);
    const body = await res.json();
    // Schema rejects >160 outright → deterministic fallback, never a raw write.
    expect(body.results[0].metadataSource).toBe("fallback");
    const video = harness.db.videos.find((entry: any) => entry.id === body.results[0].videoId)!;
    expect(video.title.length).toBeLessThanOrEqual(160);
  });

  it("reports partial failures in a batch", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [
        { url: "https://cdn.example.com/valid.mp4", metadata: preparedMetadata() },
        { url: "ftp://bad.example.com/nope.mp4" },
      ],
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(207);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results[0].status).toBe("published");
    expect(body.results[1].status).toBe("failed");
  });

  it("never returns secrets in the response", async () => {
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4", metadata: preparedMetadata() }],
    });
    const res = await POST(req);
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/SUPABASE|SECRET|OPENROUTER|API_KEY/i);
  });

  it("logs the publishing action to audit_logs", async () => {
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4", metadata: preparedMetadata() }],
    });
    await POST(req);

    const auditRow = harness.db.audit_logs.find((row: any) => row.action === "video_published_from_direct_url")!;
    expect(auditRow).toBeTruthy();
    expect(auditRow.actor_id).toBe(ADMIN_ID);
    expect(auditRow.metadata.provider).toBe("direct_url");
    expect(auditRow.metadata.host).toBe("cdn.example.com");
  });

  it("does not invoke any Streamtape API, relay, or remote-import operation", async () => {
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4", metadata: preparedMetadata() }],
    });
    await POST(req);

    // No upload jobs should have been created — direct_url publishing is synchronous.
    expect(harness.db.upload_jobs).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
