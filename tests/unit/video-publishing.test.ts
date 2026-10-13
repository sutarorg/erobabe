import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "./helpers/fake-supabase";

/**
 * The upload pipeline must not be blocked by any AI provider — and the
 * backend must never call one. Valid metadata prepared in the browser is
 * re-validated and written as-is; when no valid payload arrives, the video is
 * still created with deterministic file-name metadata explicitly marked for
 * human review.
 */

const dbState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => dbState.client,
  createServiceClient: () => dbState.client,
  isValidSupabaseUrl: () => true,
  isValidSupabaseKey: () => true,
  isSupabaseConfigured: () => true,
}));

import { createGeneratedVideo, toPreparedMetadata, isPreparedMetadata } from "@/lib/video/publishing";

const CATEGORY_ID = "cat-boudoir";

function seedDb() {
  const fake = createFakeSupabase({
    categories: [{ id: CATEGORY_ID, label: "Boudoir" }],
    videos: [],
    tags: [],
    video_tags: [],
  });
  dbState.client = fake.client;
  return fake;
}

function preparedMetadata(overrides: Record<string, unknown> = {}) {
  return {
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    source: "ai" as const,
    ...overrides,
  };
}

beforeEach(() => {
  seedDb();
  vi.unstubAllGlobals();
});

describe("createGeneratedVideo metadata", () => {
  it("uses browser-prepared AI metadata without any backend AI request", async () => {
    // If the backend tried to call Gemini/OpenRouter it would hit this fetch —
    // which fails the test by existing at all.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
      prepared: preparedMetadata(),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(metadata.source).toBe("ai");
    expect(metadata.warning).toBeUndefined();
    expect(metadata.title).toBe("Evening in Velvet");
    expect(video.title).toBe("Evening in Velvet");
  });

  it("keeps publishing with file-name metadata when no prepared metadata arrives", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "evening_in_velvet_20240512.mov",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(metadata.source).toBe("fallback");
    expect(metadata.warning).toMatch(/AI metadata unavailable/);
    expect(metadata.warning).toMatch(/review/i);
    expect(metadata.title).toBe("Evening In Velvet");
    expect(metadata.description).toMatch(/replace it before publishing/);
    expect(metadata.tags).toContain("boudoir");
    expect(video.title).toBe("Evening In Velvet");
  });

  it("rejects malformed prepared metadata and falls back instead of writing it", async () => {
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "evening_in_velvet_4k.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
      prepared: { title: "x", description: "", tags: [], source: "ai" },
    });

    expect(metadata.source).toBe("fallback");
    expect(metadata.title).toBe("Evening In Velvet 4k");
    expect(metadata.warning).toMatch(/AI metadata unavailable/);
  });

  it("falls back when sanitisation would leave the row untagged", async () => {
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
      prepared: { title: "Valid title here", description: "Valid description.", tags: ["   ", ""], source: "ai" },
    });
    expect(metadata.source).toBe("fallback");
    expect(metadata.tags.length).toBeGreaterThan(0);
  });

  it("accepts a fallback payload prepared in the browser when the AI was unavailable", async () => {
    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
      prepared: {
        title: "Evening In Velvet 4k",
        description: "Boudoir video. AI metadata was unavailable — review before publishing.",
        tags: ["boudoir", "editorial"],
        source: "fallback",
        warning: "AI metadata unavailable (key missing). Review the title and description before publishing.",
      },
    });

    expect(metadata.source).toBe("fallback");
    expect(metadata.warning).toMatch(/AI metadata unavailable/);
    expect(video.title).toBe("Evening In Velvet 4k");
  });

  it("sanitises and persists prepared metadata — title, description, tags", async () => {
    const fake = seedDb();
    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
      prepared: preparedMetadata({
        title: "  Evening   in Velvet  ",
        description: "Line one.\nLine two.",
        tags: ["mature", "MATURE", "4k", "made-up-would-need-filtering"],
      }),
    });

    // Server-side sanitisation: whitespace collapsed, duplicates removed.
    expect(metadata.title).toBe("Evening in Velvet");
    expect(metadata.description).toBe("Line one. Line two.");
    expect(metadata.tags).toEqual(["mature", "4k", "made-up-would-need-filtering"]);

    const row = fake.db.videos.find((entry) => entry.id === video.id)!;
    expect(row.title).toBe("Evening in Velvet");
    expect(row.description).toBe("Line one. Line two.");

    const links = fake.db.video_tags.filter((entry) => entry.video_id === video.id);
    expect(links).toHaveLength(3);
    const persistedTags = fake.db.tags.map((entry) => entry.label);
    expect(persistedTags).toEqual(expect.arrayContaining(["mature", "4k"]));
  });

  it("attaches the fallback tags so the video is not left untagged", async () => {
    const fake = seedDb();
    const { video } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    const links = fake.db.video_tags.filter((entry) => entry.video_id === video.id);
    expect(links.length).toBeGreaterThan(0);
    expect(fake.db.tags.length).toBeGreaterThan(0);
  });
});

describe("toPreparedMetadata / isPreparedMetadata", () => {
  it("accepts a valid payload and sanitises it", () => {
    const parsed = toPreparedMetadata(preparedMetadata({ title: "A  valid   title", tags: ["mature", "mature", "4k"] }));
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("A valid title");
    expect(parsed!.tags).toEqual(["mature", "4k"]);
    expect(isPreparedMetadata(preparedMetadata())).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(toPreparedMetadata(null)).toBeNull();
    expect(toPreparedMetadata("text")).toBeNull();
    expect(toPreparedMetadata({})).toBeNull();
    expect(toPreparedMetadata(preparedMetadata({ title: "ab" }))).toBeNull(); // too short
    expect(toPreparedMetadata(preparedMetadata({ title: "a".repeat(200) }))).toBeNull(); // too long
    expect(toPreparedMetadata(preparedMetadata({ description: "" }))).toBeNull();
    expect(toPreparedMetadata(preparedMetadata({ tags: [] }))).toBeNull();
    expect(toPreparedMetadata(preparedMetadata({ tags: Array(9).fill("mature") }))).toBeNull(); // cap
    expect(toPreparedMetadata(preparedMetadata({ source: "unknown" }))).toBeNull(); // type-safe source
    expect(toPreparedMetadata(preparedMetadata({ tags: "mature,4k" }))).toBeNull(); // tags must be an array
    expect(isPreparedMetadata({ title: "ok title", description: "ok", tags: ["mature"] })).toBe(false);
  });

  it("strips control characters from tags before they can be written", () => {
    const parsed = toPreparedMetadata(preparedMetadata({ tags: ["ma\nture", "  4k  "] }));
    expect(parsed!.tags).toEqual(["ma ture", "4k"]);
  });
});
