import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestedMetadata } from "@/lib/metadata/suggestion";
import { createFakeSupabase } from "./helpers/fake-supabase";

/**
 * The upload pipeline must not be blocked by the AI provider. When the AI suggestion
 * fails (malformed output, quota, missing key) the video is still created with
 * deterministic file-name metadata, and the reason is reported back so the
 * admin knows it needs reviewing.
 */

const aiState = vi.hoisted(() => ({
  suggest: null as null | ((params: { fileName?: string; category?: string }) => Promise<SuggestedMetadata>),
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

const dbState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => dbState.client,
  createServiceClient: () => dbState.client,
  isValidSupabaseUrl: () => true,
  isValidSupabaseKey: () => true,
  isSupabaseConfigured: () => true,
}));

import { createGeneratedVideo } from "@/lib/video/publishing";

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

function aiSuggestion(overrides: Partial<SuggestedMetadata> = {}): SuggestedMetadata {
  return {
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    category: "Boudoir",
    reasoning: "AI-generated suggestion, requires human review",
    ...overrides,
  };
}

beforeEach(() => {
  aiState.suggest = null;
  aiState.calls = 0;
  seedDb();
});

describe("createGeneratedVideo metadata", () => {
  it("uses the AI suggestion when the provider answers", async () => {
    aiState.suggest = async () => aiSuggestion();
    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(metadata.source).toBe("ai");
    expect(metadata.warning).toBeUndefined();
    expect(metadata.title).toBe("Evening in Velvet");
    expect(video.title).toBe("Evening in Velvet");
  });

  it("keeps publishing with file-name metadata when the provider fails", async () => {
    aiState.suggest = async () => {
      throw new Error("The model's reply could not be parsed as JSON");
    };

    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "evening_in_velvet_20240512.mov",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(aiState.calls).toBe(1);
    expect(metadata.source).toBe("fallback");
    expect(metadata.warning).toMatch(/AI metadata unavailable/);
    expect(metadata.title).toBe("Evening In Velvet");
    expect(metadata.description).toMatch(/replace it before publishing/);
    expect(metadata.tags).toContain("boudoir");
    expect(video.title).toBe("Evening In Velvet");
  });

  it("redacts key material from the warning an admin sees", async () => {
    aiState.suggest = async () => {
      throw new Error(
        "Request failed: https://openrouter.ai/api/v1/chat/completions authorization=sk-or-v1-FakeSecretKeyMaterial1234567890abcdef"
      );
    };

    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "evening_in_velvet_20240512.mov",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(metadata.source).toBe("fallback");
    expect(metadata.warning).toMatch(/AI metadata unavailable/);
    expect(metadata.warning).not.toContain("FakeSecretKeyMaterial");
  });

  it("attaches the fallback tags so the video is not left untagged", async () => {
    const fake = seedDb();
    aiState.suggest = async () => {
      throw new Error("AI quota or rate limit exceeded");
    };

    const { video } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    const links = fake.db.video_tags.filter((row) => row.video_id === video.id);
    expect(links.length).toBeGreaterThan(0);
    expect(fake.db.tags.length).toBeGreaterThan(0);
  });

  it("skips a second AI call when metadata was prepared while the file was uploading", async () => {
    aiState.suggest = async () => {
      throw new Error("suggestVideoMetadata should not run");
    };

    const prepared = {
      title: "Already Written",
      description: "Prepared while the bytes were in flight.",
      tags: ["mature", "4k"],
      source: "ai" as const,
    };
    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
      prepared,
    });

    expect(aiState.calls).toBe(0);
    expect(metadata.source).toBe("ai");
    expect(metadata.title).toBe("Already Written");
    expect(video.title).toBe("Already Written");
  });

  it("ignores prepared metadata that is not usable and asks the AI provider instead", async () => {
    aiState.suggest = async () => aiSuggestion();
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
      prepared: { title: "x", description: "", tags: [], source: "ai" },
    });

    expect(aiState.calls).toBe(1);
    expect(metadata.title).toBe("Evening in Velvet");
  });

  it("falls back when the AI provider returns an unusable field, such as a blank title", async () => {
    aiState.suggest = async () => aiSuggestion({ title: "   " });
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(metadata.source).toBe("fallback");
    expect(metadata.title.trim().length).toBeGreaterThan(0);
  });
});
