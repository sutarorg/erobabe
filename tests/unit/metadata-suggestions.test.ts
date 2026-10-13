import { describe, it, expect } from "vitest";
import {
  cleanSuggestion,
  fallbackSuggestion,
  humanizeFileName,
  normalizeCategory,
  normalizeTags,
  parseLooseJson,
  redactKeyMaterial,
} from "@/lib/metadata/suggestions";

/**
 * The deterministic fallback and validation helpers shared by the browser
 * OpenRouter client and the server publishing pipeline. Pure functions — no
 * network, no key material.
 */

const payload = {
  title: "Evening in Velvet",
  description: "An elegant portrait.",
  tags: ["mature", "4k"],
  category: "Boudoir",
};

describe("parseLooseJson", () => {
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
    const raw = "\uFEFF\u200B" + JSON.stringify(payload);
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

describe("cleanSuggestion", () => {
  it("validates a well-formed payload", () => {
    expect(cleanSuggestion(payload, "Mature")).toEqual(payload);
  });

  it("throws when required fields are missing", () => {
    expect(() => cleanSuggestion({ title: "x" }, "Mature")).toThrow(/incomplete/i);
    expect(() => cleanSuggestion(null, "Mature")).toThrow(/incomplete/i);
    expect(() => cleanSuggestion(payload, "Mature").valueOf()).not.toThrow();
  });

  it("rejects an empty tag list", () => {
    expect(() => cleanSuggestion({ ...payload, tags: [] }, "Mature")).toThrow();
  });

  it("rejects an over-long title instead of truncating silently", () => {
    expect(() => cleanSuggestion({ ...payload, title: "a".repeat(300) }, "Mature")).toThrow(/too long/i);
  });

  it("drops duplicate and empty tags and filters to the permitted list", () => {
    const cleaned = cleanSuggestion({ ...payload, tags: ["mature", "Mature", "", "   ", "made-up", "4k"] }, "Mature");
    expect(cleaned.tags).toEqual(["mature", "4k"]);
  });

  it("keeps the AI output when the model answers with only off-list tags", () => {
    const cleaned = cleanSuggestion({ ...payload, tags: ["nope", "alsono"] }, "Boudoir");
    expect(cleaned.title).toBe("Evening in Velvet");
    expect(cleaned.tags.length).toBeGreaterThan(0);
    expect(cleaned.tags).toContain("boudoir");
  });

  it("falls back to a known category for invalid model categories", () => {
    expect(cleanSuggestion({ ...payload, category: "Not A Category" }, "Solo").category).toBe("Solo");
    expect(cleanSuggestion({ ...payload, category: "Not A Category" }, "Whatever").category).toBe("Mature");
  });
});

describe("tag and category normalization", () => {
  it("maps near-miss tags onto the permitted vocabulary", () => {
    expect(normalizeTags(["MILF", "girl-on-girl", "4K UHD"])).toEqual(["mature", "lesbian", "4k"]);
  });

  it("normalises separators and case", () => {
    expect(normalizeTags(["Girl-On-Girl", "HD", "hd"])).toEqual(["lesbian", "hd"]);
  });

  it("normalises categories case-insensitively", () => {
    expect(normalizeCategory("boudoir", "Mature")).toBe("Boudoir");
    expect(normalizeCategory("", "solo")).toBe("Solo");
    expect(normalizeCategory("", "")).toBe("Mature");
  });
});

describe("redactKeyMaterial", () => {
  it("redacts Google-style keys", () => {
    const redacted = redactKeyMaterial("key AIzaFakeKeyMaterial1234567890abcd and AQ.Ab8FakeKeyMaterial");
    expect(redacted).not.toContain("AIzaFakeKeyMaterial");
    expect(redacted).not.toContain("AQ.Ab8FakeKeyMaterial");
    expect(redacted).toMatch(/redacted/);
  });

  it("redacts OpenRouter-style keys", () => {
    const redacted = redactKeyMaterial("Authorization failed for sk-or-v1-abcdef1234567890abcdef");
    expect(redacted).not.toContain("sk-or-v1-abcdef1234567890abcdef");
    expect(redacted).toMatch(/redacted/);
  });

  it("redacts bearer tokens", () => {
    const redacted = redactKeyMaterial("header was Bearer some.secret.value");
    expect(redacted).not.toContain("some.secret.value");
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
    expect(suggestion.reasoning).toMatch(/AI metadata unavailable/);
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
