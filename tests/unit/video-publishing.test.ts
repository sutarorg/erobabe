import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestedMetadata } from "@/lib/gemini/client";
import { createFakeSupabase } from "./helpers/fake-supabase";

/**
 * The upload pipeline must not be blocked by Gemini. When the AI suggestion
 * fails (malformed output, quota, missing key) the video is still created with
 * deterministic file-name metadata, and the reason is reported back so the
 * admin knows it needs reviewing.
 */

const geminiState = vi.hoisted(() => ({
  suggest: null as null | ((params: { fileName?: string; category?: string }) => Promise<SuggestedMetadata>),
  calls: 0,
}));

vi.mock("@/lib/gemini/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/client")>();
  return {
    ...actual,
    suggestVideoMetadata: async (params: { fileName?: string; category?: string }) => {
      geminiState.calls += 1;
      if (!geminiState.suggest) throw new Error("suggestVideoMetadata not stubbed");
      return geminiState.suggest(params);
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
  geminiState.suggest = null;
  geminiState.calls = 0;
  seedDb();
});

describe("createGeneratedVideo metadata", () => {
  it("uses the AI suggestion when Gemini answers", async () => {
    geminiState.suggest = async () => aiSuggestion();
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

  it("keeps publishing with file-name metadata when Gemini fails", async () => {
    geminiState.suggest = async () => {
      throw new Error("Gemini returned malformed JSON — its response could not be parsed as JSON");
    };

    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "evening_in_velvet_20240512.mov",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(geminiState.calls).toBe(1);
    expect(metadata.source).toBe("fallback");
    expect(metadata.warning).toMatch(/AI metadata unavailable/);
    expect(metadata.title).toBe("Evening In Velvet");
    expect(metadata.description).toMatch(/replace it before publishing/);
    expect(metadata.tags).toContain("boudoir");
    expect(video.title).toBe("Evening In Velvet");
  });

  it("attaches the fallback tags so the video is not left untagged", async () => {
    const fake = seedDb();
    geminiState.suggest = async () => {
      throw new Error("Gemini quota or rate limit exceeded");
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

  it("skips a second Gemini call when metadata was prepared while the file was uploading", async () => {
    geminiState.suggest = async () => {
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

    expect(geminiState.calls).toBe(0);
    expect(metadata.source).toBe("ai");
    expect(metadata.title).toBe("Already Written");
    expect(video.title).toBe("Already Written");
  });

  it("ignores prepared metadata that is not usable and asks Gemini instead", async () => {
    geminiState.suggest = async () => aiSuggestion();
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "direct_url",
      prepared: { title: "x", description: "", tags: [], source: "ai" },
    });

    expect(geminiState.calls).toBe(1);
    expect(metadata.title).toBe("Evening in Velvet");
  });

  it("falls back when Gemini returns an unusable field, such as a blank title", async () => {
    geminiState.suggest = async () => aiSuggestion({ title: "   " });
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
