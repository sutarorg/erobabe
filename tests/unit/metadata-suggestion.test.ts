import { describe, it, expect } from "vitest";
import {
  fallbackSuggestion,
  humanizeFileName,
  parseLooseJson,
  redactKeyMaterial,
  validateSuggestionPayload,
} from "@/lib/metadata/suggestion";

/**
 * Provider-neutral metadata helpers: tolerant JSON parsing, payload validation,
 * the deterministic fallback, and redaction. No network and no provider mocks.
 */

function modelOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    category: "Boudoir",
    ...overrides,
  });
}

describe("validateSuggestionPayload", () => {
  it("returns a validated suggestion from model output", () => {
    const result = validateSuggestionPayload(modelOutput(), "Boudoir");
    expect(result).toMatchObject({
      ok: true,
      suggestion: {
        title: "Evening in Velvet",
        description: expect.stringContaining("cinematic light"),
        tags: ["mature", "boudoir", "4k"],
        category: "Boudoir",
      },
    });
    if (result.ok) expect(result.suggestion.reasoning).toMatch(/human review/);
  });

  it("rejects malformed JSON", () => {
    const result = validateSuggestionPayload("this is not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/could not be parsed/);
  });

  it("rejects incomplete suggestions and names the missing field", () => {
    const result = validateSuggestionPayload(JSON.stringify({ title: "Only a title" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/incomplete/);
  });

  it("parses a fenced JSON block", () => {
    const result = validateSuggestionPayload("```json\n" + modelOutput() + "\n```");
    expect(result.ok).toBe(true);
  });

  it("filters off-list tags and keeps a usable suggestion", () => {
    const result = validateSuggestionPayload(modelOutput({ tags: ["mature", "not-a-real-tag-xyz", "boudoir"] }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestion.tags).toContain("mature");
      expect(result.suggestion.tags).not.toContain("not-a-real-tag-xyz");
    }
  });

  it("falls back to a known category for invalid model categories", () => {
    const result = validateSuggestionPayload(modelOutput({ category: "Quantum Cooking" }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.category).toBe("Boudoir");
  });

  it("accepts tags sent as a comma-separated string", () => {
    const result = validateSuggestionPayload(modelOutput({ tags: "mature, boudoir, 4k" }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.tags).toEqual(expect.arrayContaining(["mature", "boudoir"]));
  });
});

describe("redactKeyMaterial", () => {
  it("removes OpenRouter keys", () => {
    const out = redactKeyMaterial("Authorization: Bearer sk-or-v1-abcdef1234567890abcdef failed");
    expect(out).not.toContain("sk-or-v1-abcdef");
  });

  it("removes legacy-looking sk- keys and named key assignments", () => {
    expect(redactKeyMaterial("key sk-abcdefghijklmnopqrstuvwx leaked")).not.toContain("abcdefghijklmnop");
    expect(redactKeyMaterial("api_key=supersecretvalue123")).not.toContain("supersecretvalue123");
  });

  it("leaves ordinary messages alone", () => {
    expect(redactKeyMaterial("OpenRouter request failed (HTTP 500)")).toBe("OpenRouter request failed (HTTP 500)");
  });
});

describe("parseLooseJson", () => {
  const payload = {
    title: "Evening in Velvet",
    description: "An elegant portrait.",
    tags: ["mature", "4k"],
    category: "Boudoir",
  };

  it("parses a plain JSON object", () => {
    expect(parseLooseJson(JSON.stringify(payload))?.value).toEqual(payload);
  });

  it("unwraps markdown fences", () => {
    const raw = "```json\n" + JSON.stringify(payload) + "\n```";
    expect(parseLooseJson(raw)?.value).toEqual(payload);
  });

  it("ignores prose before and after the payload", () => {
    const raw = `Here is your metadata:\n${JSON.stringify(payload)}\nLet me know if you want changes!`;
    expect(parseLooseJson(raw)?.value).toEqual(payload);
  });

  it("repairs raw newlines inside strings", () => {
    const raw = '{"title":"Velvet","description":"line one\nline two","tags":["mature"],"category":"Mature"}';
    const parsed = parseLooseJson(raw)?.value as Record<string, unknown>;
    expect(parsed.description).toBe("line one\nline two");
  });

  it("repairs smart quotes and trailing commas", () => {
    const raw = '{"title":"“Velvet”","description":"soft light","tags":["mature",],"category":"Mature"}';
    const parsed = parseLooseJson(raw)?.value as Record<string, unknown>;
    expect(parsed.title).toBe('"Velvet"');
    expect(parsed.tags).toEqual(["mature"]);
  });

  it("strips a byte-order mark and zero-width characters", () => {
    const raw = "﻿​" + JSON.stringify(payload);
    expect(parseLooseJson(raw)?.value).toEqual(payload);
  });

  it("recovers the fields that completed from a truncated object", () => {
    const raw = '{"title":"Evening in Velvet","description":"An elegant portrait.","tags":["mature","4k"],"category":"Bou';
    const result = parseLooseJson(raw);
    expect(result?.strategy).toBe("truncated-salvage");
    expect(result?.value).toMatchObject({ title: "Evening in Velvet", tags: ["mature", "4k"] });
  });

  it("returns null when there is no JSON to recover", () => {
    expect(parseLooseJson("I am not able to help with that request.")).toBeNull();
    expect(parseLooseJson("{not json")).toBeNull();
    expect(parseLooseJson("")).toBeNull();
  });
});

describe("fallbackSuggestion", () => {
  it("builds reviewable metadata from the file name and category", () => {
    const suggestion = fallbackSuggestion("evening_in_velvet-4k.mov", "Boudoir");
    expect(suggestion.title).toBe("Evening In Velvet 4k");
    expect(suggestion.category).toBe("Boudoir");
    expect(suggestion.tags).toContain("boudoir");
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(suggestion.description).toMatch(/review|replace/i);
  });

  it("always lands on a known category and a permitted tag", () => {
    const suggestion = fallbackSuggestion("clip.mp4", "Not A Category");
    expect(suggestion.category).toBe("Mature");
    expect(suggestion.tags.length).toBeGreaterThan(0);
  });

  it("drops long id runs and falls back to the category for empty names", () => {
    expect(fallbackSuggestion("", "Solo").title).toBe("Solo video");
    expect(humanizeFileName("evening_in_velvet_20240512_1080p.mov")).toBe("Evening In Velvet 1080p");
  });
});

