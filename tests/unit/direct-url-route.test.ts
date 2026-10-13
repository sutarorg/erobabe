import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHarness, jsonRequest, ADMIN_ID, CATEGORY_ID } from "./helpers/video-route-harness";
import type { FakeDb } from "./helpers/fake-supabase";

/**
 * Tests for the direct-URL publishing route (/api/videos/upload-url).
 *
 * The route validates URLs, generates metadata via OpenRouter, creates video
 * records with `provider = 'direct_url'`, stores the URL in `playable_url`,
 * and publishes immediately. No hosting-provider API or relay is used.
 */

const aiState = vi.hoisted(() => ({
  suggest: null as null | ((params: { fileName?: string; category?: string }) => Promise<any>),
  calls: 0,
}));

vi.mock("@/lib/metadata/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/metadata/openrouter")>();
  return {
    ...actual,
    suggestVideoMetadata: async (params: { fileName?: string; category?: string }) => {
      aiState.calls += 1;
      if (!aiState.suggest) throw new Error("suggestVideoMetadata not stubbed");
      return aiState.suggest(params);
    },
  };
});

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

/** Frame capture is stubbed: tests never spawn ffmpeg or fetch a video. */
const frameState = vi.hoisted(() => ({ generate: null as null | ((url: string) => Promise<string>), calls: [] as string[] }));
vi.mock("@/lib/video/frame-thumbnail", () => ({
  generateFrameThumbnail: async (_service: unknown, _userId: string, url: string) => {
    frameState.calls.push(url);
    if (!frameState.generate) throw new Error("frame capture not stubbed");
    return frameState.generate(url);
  },
}));

import { POST } from "@/app/api/videos/upload-url/route";

function aiSuggestion() {
  return {
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    category: "Boudoir",
    reasoning: "AI-generated suggestion, requires human review",
  };
}

function setupHarness(overrides: Partial<FakeDb> = {}) {
  const harness = createHarness(overrides);
  harnessState.service = harness.service;
  harnessState.auth = harness.auth;
  return harness;
}

beforeEach(() => {
  aiState.suggest = null;
  aiState.calls = 0;
  setupHarness();
});

describe("POST /api/videos/upload-url — authorization", () => {
  it("rejects unauthenticated requests", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: harnessState.service.from,
    };
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/v.mp4" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    harnessState.auth = {
      auth: { getUser: async () => ({ data: { user: { id: "non-admin" } } }) },
      from: harnessState.service.from,
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
    aiState.suggest = async () => aiSuggestion();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/video.mp4?token=abc123" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBe(1);
    expect(body.results[0].status).toBe("published");
  });

  it("accepts uppercase MP4 extension", async () => {
    aiState.suggest = async () => aiSuggestion();
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
    aiState.suggest = async () => aiSuggestion();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [
        { url: "https://cdn.example.com/v.mp4" },
        { url: "https://cdn.example.com/v.mp4" },
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

describe("POST /api/videos/upload-url — publishing", () => {
  it("publishes a valid direct URL as direct_url provider", async () => {
    aiState.suggest = async () => aiSuggestion();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4" }],
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

    // Verify the video record was created correctly.
    const { db } = harnessState.service.__harness || {};
    // Look up via the fake DB directly.
  });

  it("stores the direct URL in playable_url and embed_url as null", async () => {
    aiState.suggest = async () => aiSuggestion();
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://video.damplips.com/video7/717/70.mp4" }],
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

  it("falls back to file-name metadata when the AI provider fails", async () => {
    aiState.suggest = async () => {
      throw new Error("AI quota exceeded");
    };
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
  });

  it("reports partial failures in a batch", async () => {
    aiState.suggest = async () => aiSuggestion();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [
        { url: "https://cdn.example.com/valid.mp4" },
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
    aiState.suggest = async () => aiSuggestion();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4" }],
    });
    const res = await POST(req);
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/SUPABASE|SECRET|GEMINI|OPENROUTER|API_KEY/i);
  });

  it("logs the publishing action to audit_logs", async () => {
    aiState.suggest = async () => aiSuggestion();
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4" }],
    });
    await POST(req);

    const auditRow = harness.db.audit_logs.find((row: any) => row.action === "video_published_from_direct_url")!;
    expect(auditRow).toBeTruthy();
    expect(auditRow.actor_id).toBe(ADMIN_ID);
    expect(auditRow.metadata.provider).toBe("direct_url");
    expect(auditRow.metadata.host).toBe("cdn.example.com");
  });

  it("does not invoke any Streamtape API, relay, or remote-import operation", async () => {
    aiState.suggest = async () => aiSuggestion();
    const harness = setupHarness();
    const req = jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4" }],
    });
    await POST(req);

    // No upload jobs should have been created — direct_url publishing is synchronous.
    expect(harness.db.upload_jobs).toHaveLength(0);
  });
});
describe("POST /api/videos/upload-url — duplicate detector and automatic thumbnail", () => {
  const EXISTING = {
    id: "existing-1",
    slug: "evening-in-velvet-old",
    title: "Evening in Velvet (old)",
    source_key: "cdn.example.com/clip.mp4",
    thumbnail_url: null,
  };

  it("skips a link that is already published, and creates nothing for it", async () => {
    aiState.suggest = async () => aiSuggestion();
    frameState.generate = async () => "https://cdn.example.com/video-thumbnails/auto.jpg";
    const harness = setupHarness({ videos: [EXISTING] });
    const res = await POST(jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4?token=1" }],
    }));
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.results[0].status).toBe("skipped");
    expect(body.results[0].duplicate).toMatchObject({ videoId: "existing-1", reason: "same_link" });
    expect(harness.db.videos).toHaveLength(1);
  });

  it("publishes a duplicate when the admin ticks 'publish anyway'", async () => {
    aiState.suggest = async () => aiSuggestion();
    frameState.generate = async () => "https://cdn.example.com/video-thumbnails/auto.jpg";
    const harness = setupHarness({ videos: [EXISTING] });
    const res = await POST(jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/clip.mp4", allowDuplicate: true }],
    }));
    const body = await res.json();
    expect(body.succeeded).toBe(1);
    expect(harness.db.videos).toHaveLength(2);
    expect(harness.db.videos[1].source_key).toBe("cdn.example.com/clip.mp4");
  });

  it("captures a frame thumbnail when the admin supplies none", async () => {
    aiState.suggest = async () => aiSuggestion();
    frameState.calls = [];
    frameState.generate = async () => "https://cdn.example.com/video-thumbnails/auto.jpg";
    const harness = setupHarness();
    const res = await POST(jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/new-scene.mp4" }],
    }));
    const body = await res.json();
    expect(body.results[0].thumbnailSource).toBe("frame");
    expect(body.results[0].thumbnailUrl).toBe("https://cdn.example.com/video-thumbnails/auto.jpg");
    expect(frameState.calls).toEqual(["https://cdn.example.com/new-scene.mp4"]);
    expect(harness.db.videos[0].thumbnail_url).toBe("https://cdn.example.com/video-thumbnails/auto.jpg");
  });

  it("still publishes, with a warning, when frame capture fails", async () => {
    aiState.suggest = async () => aiSuggestion();
    frameState.generate = async () => {
      throw new Error("No usable frame was found in the video");
    };
    const harness = setupHarness();
    const res = await POST(jsonRequest("/api/videos/upload-url", {
      categoryId: CATEGORY_ID,
      entries: [{ url: "https://cdn.example.com/no-frames.mp4" }],
    }));
    const body = await res.json();
    expect(body.results[0].status).toBe("published");
    expect(body.results[0].thumbnailSource).toBe("none");
    expect(body.results[0].thumbnailWarning).toMatch(/No usable frame/);
    expect(harness.db.videos[0].thumbnail_url).toBeNull();
  });
});
