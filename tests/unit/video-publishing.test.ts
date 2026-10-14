import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidDescription, type SuggestedMetadata } from "@/lib/metadata/suggestion";
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
    description: "An elegant, slow-paced portrait captured in soft cinematic light, with a focus on thoughtful composition and visual atmosphere. Browse the collection to discover related video listings with similar settings and thoughtfully composed visual presentations.",
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
    // The fallback title is the file name alone: no invented subtitle, no dash.
    expect(metadata.title).toBe("Evening In Velvet");
    expect(metadata.title).not.toMatch(/[\u2010-\u2015\u2212]/);
    expect(isValidDescription(metadata.description)).toBe(true);
    expect(metadata.description).not.toContain("AI metadata");
    expect(metadata.tags).toContain("boudoir");
    expect(video.title).toBe(metadata.title);
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
      description: "An elegant, slow-paced portrait captured in soft cinematic light, with a focus on thoughtful composition and visual atmosphere. Browse the collection to discover related video listings with similar settings and thoughtfully composed visual presentations.",
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

  it.each([24, 31])("repairs a %i-word AI description instead of falling back to the file name", async (count) => {
    aiState.suggest = async () => aiSuggestion({ description: Array(count).fill("word").join(" ") });
    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
    });
    // A word count on its own must not cost the admin the AI title and blurb.
    expect(metadata.source).toBe("ai");
    expect(metadata.title).toBe("Evening in Velvet");
    expect(metadata.warning).toBeUndefined();
    expect(isValidDescription(metadata.description)).toBe(true);
    expect(video.description).toBe(metadata.description);
  });

  it("falls back only when the AI description is too thin to repair", async () => {
    aiState.suggest = async () => aiSuggestion({ description: "Too thin to repair." });
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
    });
    expect(metadata.source).toBe("fallback");
    expect(metadata.warning).toMatch(/too short to repair/);
    expect(isValidDescription(metadata.description)).toBe(true);
  });

  it("regenerates prepared metadata whose description is outside the word limit", async () => {
    aiState.suggest = async () => aiSuggestion();
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
      prepared: { title: "Already Written", description: "Too short.", tags: ["mature"], source: "ai" },
    });
    expect(aiState.calls).toBe(1);
    expect(isValidDescription(metadata.description)).toBe(true);
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


describe("distinct generated video titles", () => {
  it("regenerates a case-insensitive duplicate title within the same category", async () => {
    const fake = seedDb();
    fake.db.videos.push({ id: "existing", title: "evening in velvet", category_id: CATEGORY_ID });
    const prompts: any[] = [];
    aiState.suggest = async (params) => {
      prompts.push(params);
      return aiSuggestion({ title: prompts.length === 1 ? "Evening In Velvet" : "A Quiet Evening By The Window" });
    };
    const { metadata } = await createGeneratedVideo({ service: dbState.client as never, userId: "admin-1", sourceName: "window.mp4", categoryId: CATEGORY_ID, provider: "embed" });
    expect(metadata.title).toBe("A Quiet Evening By The Window");
    expect(prompts[0].existingTitles).toContain("evening in velvet");
    expect(aiState.calls).toBe(2);
  });

  it("disambiguates repeated replies instead of publishing the same title", async () => {
    const fake = seedDb();
    fake.db.videos.push({ id: "existing", title: "Evening in Velvet", category_id: CATEGORY_ID });
    aiState.suggest = async () => aiSuggestion();
    const { metadata } = await createGeneratedVideo({ service: dbState.client as never, userId: "admin-1", sourceName: "window.mp4", categoryId: CATEGORY_ID, provider: "embed" });
    expect(metadata.title).not.toBe("Evening in Velvet");
    expect(metadata.title.length).toBeLessThanOrEqual(160);
    expect(metadata.warning).toContain("review");
  });

  it("strips the category from prepared metadata without another AI call", async () => {
    const { metadata } = await createGeneratedVideo({ service: dbState.client as never, userId: "admin-1", sourceName: "window.mp4", categoryId: CATEGORY_ID, provider: "embed", prepared: { ...aiSuggestion({ title: "Boudoir Evening By The Window" }), source: "ai" } });
    expect(metadata.title).toBe("Evening By The Window");
    expect(aiState.calls).toBe(0);
  });
});
