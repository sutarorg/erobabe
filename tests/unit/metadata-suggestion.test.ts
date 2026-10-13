import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  CATEGORY_STORIES,
  descriptionWordCount,
  isValidDescription,
  KNOWN_CATEGORIES,
  MAX_DESCRIPTION_WORDS,
  MAX_TITLE_LENGTH,
  MIN_DESCRIPTION_WORDS,
  fallbackSuggestion,
  humanizeFileName,
  normalizeDescription,
  parseLooseJson,
  redactKeyMaterial,
  sanitizeTitle,
  validateSuggestionPayload,
} from "@/lib/metadata/suggestion";

/**
 * Provider-neutral metadata helpers: tolerant JSON parsing, payload validation,
 * the deterministic fallback, and redaction. No network and no provider mocks.
 */

function modelOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light, with a focus on thoughtful composition and visual atmosphere. Browse the collection to discover related video listings.",
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

describe("description word limits and title prompt", () => {
  it.each([25, 30])("accepts a description containing %i words", (count) => {
    const description = Array(count).fill("word").join(" ");
    const result = validateSuggestionPayload(modelOutput({ description }));
    expect(result.ok).toBe(true);
    expect(descriptionWordCount(description)).toBe(count);
  });

  it("rejects a fragment too thin to repair into a description", () => {
    const result = validateSuggestionPayload(modelOutput({ description: "A short catalog description." }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/description.*25-30 words/);
  });

  it.each([24, 31, 100])("repairs a %i-word description into the published range instead of discarding it", (count) => {
    const result = validateSuggestionPayload(modelOutput({ description: Array(count).fill("word").join(" ") }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isValidDescription(result.suggestion.description)).toBe(true);
      expect(result.suggestion.title).toBe("Evening in Velvet");
      expect(result.suggestion.reasoning).toMatch(/human review/);
    }
  });

  it("keeps the model's own words when it trims an overlong description", () => {
    const source = `${Array(20).fill("word").join(" ")}. ${Array(11).fill("extra").join(" ")}.`;
    const result = validateSuggestionPayload(modelOutput({ description: source }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(descriptionWordCount(result.suggestion.description)).toBe(30);
      expect(result.suggestion.description.startsWith(Array(20).fill("word").join(" "))).toBe(true);
      // Trimming only ever removes model words; it never substitutes generated ones.
      expect(result.suggestion.description).not.toContain("unhurried");
    }
  });

  it("extends a short description with story sentences for the selected category", () => {
    const short = "Low light, soft fabric, and a long quiet moment before anything else begins.";
    const boudoir = validateSuggestionPayload(modelOutput({ description: short }), "Boudoir");
    expect(boudoir.ok).toBe(true);
    if (boudoir.ok) {
      expect(isValidDescription(boudoir.suggestion.description)).toBe(true);
      expect(boudoir.suggestion.description.startsWith(short)).toBe(true);
      expect(boudoir.suggestion.reasoning).toMatch(/extended from 13 words/);
    }
  });

  it("prefers the admin's selected category over the category the model returned", () => {
    const result = validateSuggestionPayload(modelOutput({ category: "Solo" }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.category).toBe("Boudoir");
  });

  it("lets the model choose a category only when the admin chose none", () => {
    const result = validateSuggestionPayload(modelOutput({ category: "Solo" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.category).toBe("Solo");
  });

  it("counts irregular and Unicode whitespace consistently and normalizes output", () => {
    expect(descriptionWordCount("  one\n two\tthree\u00a0four  ")).toBe(4);
    expect(descriptionWordCount(" \n ")).toBe(0);
    const result = validateSuggestionPayload(modelOutput({ description: Array(25).fill("word").join(" \n\t") }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.description).toBe(Array(25).fill("word").join(" "));
  });

  it.each([...KNOWN_CATEGORIES])("keeps fallback descriptions within 25-30 words for %s", (category) => {
    expect(isValidDescription(fallbackSuggestion("clip.mp4", category).description)).toBe(true);
  });

  it("asks for a tube-style one-clause title and pins the metadata to the admin's category", () => {
    const prompt = buildPrompt({ fileName: "evening_in_velvet.mp4", category: "Boudoir" });
    expect(prompt).toContain("search-friendly");
    expect(prompt).toContain("25-30 words, not characters");
    expect(prompt).toContain("untrusted source data");
    // The title instruction is the point of the change: one clause, no dash.
    expect(prompt).toContain("ONE clause");
    expect(prompt).toMatch(/Never use a hyphen, en dash, em dash/);
    expect(prompt).toMatch(/consenting adult aged 18 or over/);
    expect(prompt).not.toContain("max 200 characters");
    expect(prompt).not.toContain("max 60 characters");
    const example = prompt.split("Example JSON:\n")[1];
    expect(validateSuggestionPayload(example).ok).toBe(true);
  });

  it("shows a complete, dash-free title for the admin's category", () => {
    const prompt = buildPrompt({ fileName: "evening_in_velvet.mp4", category: "Massage" });
    expect(prompt).toContain('The admin has already chosen the category "Massage"');
    expect(prompt).toContain('must be exactly "Massage"');
    expect(prompt).toContain("story-like description");
    expect(prompt).toContain("hands that begin with nothing but patience");
    // The example the model is shown must itself be valid for that category.
    const example = prompt.split("Example JSON:\n")[1];
    const validated = validateSuggestionPayload(example, "Massage");
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.suggestion.category).toBe("Massage");
      expect(validated.suggestion.title).toBe(CATEGORY_STORIES.Massage.titleExample);
      expect(validated.suggestion.title).not.toMatch(/[\u2010-\u2015\u2212]/);
    }
  });

  it("never lets a dash survive into a validated title", () => {
    const payload = { ...JSON.parse(modelOutput()), title: "Evening in Velvet \u2014 A Story in Low Light" };
    const result = validateSuggestionPayload(JSON.stringify(payload), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestion.title).not.toMatch(/[\u2010-\u2015\u2212]/);
      expect(result.suggestion.title).toBe("Evening in Velvet A Story in Low Light");
    }
  });

  it.each([...KNOWN_CATEGORIES])("produces a valid, dash-free title example for %s", (category) => {
    const prompt = buildPrompt({ fileName: "evening_in_velvet.mp4", category });
    const example = prompt.split("Example JSON:\n")[1];
    const validated = validateSuggestionPayload(example, category);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.suggestion.category).toBe(category);
      expect(isValidDescription(validated.suggestion.description)).toBe(true);
      expect(validated.suggestion.title).toBe(CATEGORY_STORIES[category].titleExample);
      expect(validated.suggestion.title).not.toMatch(/[\u2010-\u2015\u2212]/);
      expect(validated.suggestion.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    }
  });

  it.each([...KNOWN_CATEGORIES])("writes a 25-30 word story blurb for %s", (category) => {
    expect(isValidDescription(CATEGORY_STORIES[category].blurb)).toBe(true);
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
  it("builds reviewable metadata from the file name and category, with no invented subtitle", () => {
    const suggestion = fallbackSuggestion("evening_in_velvet-4k.mov", "Boudoir");
    expect(suggestion.title).toBe("Evening In Velvet 4k");
    expect(suggestion.category).toBe("Boudoir");
    expect(suggestion.tags).toContain("boudoir");
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.description).not.toMatch(/AI metadata|replace|unavailable/i);
  });

  it.each([...KNOWN_CATEGORIES])("writes %s metadata without a dash in the title", (category) => {
    const suggestion = fallbackSuggestion("evening_in_velvet.mov", category);
    expect(suggestion.category).toBe(category);
    expect(suggestion.title).toBe("Evening In Velvet");
    expect(suggestion.title).not.toMatch(/[\u2010-\u2015\u2212-]/);
    expect(suggestion.description).toBe(CATEGORY_STORIES[category].blurb);
    expect(suggestion.description).not.toMatch(/explore this listing|playback controls|related videos/i);
    expect(isValidDescription(suggestion.description)).toBe(true);
  });

  it("always lands on a known category and a permitted tag", () => {
    const suggestion = fallbackSuggestion("clip.mp4", "Not A Category");
    expect(suggestion.category).toBe("Mature");
    expect(suggestion.tags.length).toBeGreaterThan(0);
  });

  it("drops long id runs and falls back to the category for empty names", () => {
    expect(fallbackSuggestion("", "Solo").title).toBe("Solo Scene");
    expect(humanizeFileName("evening_in_velvet_20240512_1080p.mov")).toBe("Evening In Velvet 1080p");
  });

  it("drops stacked container suffixes instead of putting them in the title", () => {
    expect(humanizeFileName("Hands_Only.mp4.ts.mp4")).toBe("Hands Only");
    expect(humanizeFileName("evening_in_velvet.mkv.mp4")).toBe("Evening In Velvet");
    expect(humanizeFileName("evening_in_velvet.ts")).toBe("Evening In Velvet");
    // A short unknown extension is still stripped; a long trailing word is not.
    expect(humanizeFileName("clip.mov")).toBe("Clip");
    expect(humanizeFileName("clip.unknownext")).toBe("Clip Unknownext");
  });
});

describe("normalizeDescription", () => {
  it("leaves an in-range description untouched", () => {
    const description = Array(27).fill("word").join(" ");
    expect(normalizeDescription(description, "Boudoir")).toEqual({ description, adjusted: null });
  });

  it("rejects an empty description and a fragment too thin to repair", () => {
    expect(normalizeDescription("", "Boudoir")).toBeNull();
    expect(normalizeDescription("   ", "Boudoir")).toBeNull();
    expect(normalizeDescription("A short blurb.", "Boudoir")).toBeNull();
  });

  it("never repeats a closer sentence within one description", () => {
    const result = normalizeDescription(Array(12).fill("word").join(" "), "Solo");
    expect(result).not.toBeNull();
    const sentences = result!.description.split(/(?<=[.!?])\s+/);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  /**
   * The repair has to land inside the window for every starting length it
   * claims to handle, in every category — a single uncovered length is what
   * used to send an upload back to file-name metadata.
   */
  it.each([...KNOWN_CATEGORIES])(
    "lands every repairable length inside 25-30 words for %s",
    (category) => {
      for (let count = 8; count <= 60; count += 1) {
        const source = Array(count).fill("word").join(" ");
        const result = normalizeDescription(source, category);
        expect(result, `${count} words`).not.toBeNull();
        const words = descriptionWordCount(result!.description);
        expect(words, `${count} words → ${result!.description}`).toBeGreaterThanOrEqual(MIN_DESCRIPTION_WORDS);
        expect(words, `${count} words → ${result!.description}`).toBeLessThanOrEqual(MAX_DESCRIPTION_WORDS);
      }
    }
  );

  it.each([8, 12, 17, 21, 24])("extends a %i-word description into range", (count) => {
    const result = normalizeDescription(Array(count).fill("word").join(" "), "Romantic");
    expect(result).not.toBeNull();
    expect(isValidDescription(result!.description)).toBe(true);
    expect(result!.adjusted).toMatch(/^extended from/);
  });

  it("cuts an overlong description on a sentence boundary when it can", () => {
    const source = `${Array(26).fill("word").join(" ")}. ${Array(26).fill("tail").join(" ")}.`;
    const result = normalizeDescription(source, "Romantic");
    expect(result).not.toBeNull();
    expect(descriptionWordCount(result!.description)).toBe(26);
    expect(result!.description).not.toContain("tail");
    expect(result!.adjusted).toMatch(/^trimmed from 52 words/);
  });

  it("trims a single long run-on sentence without breaking a word", () => {
    const result = normalizeDescription(Array(48).fill("word").join(" "), "Romantic");
    expect(result).not.toBeNull();
    expect(descriptionWordCount(result!.description)).toBe(30);
    expect(result!.description.endsWith(".")).toBe(true);
  });

  it("drops a dangling connector left by a hard cut", () => {
    const words = [...Array(29).fill("word"), "and"];
    const result = normalizeDescription(words.join(" "), "Romantic");
    expect(result).not.toBeNull();
    expect(result!.description.endsWith("and.")).toBe(false);
  });
});

describe("sanitizeTitle", () => {
  it("strips em, en, and separator dashes", () => {
    expect(sanitizeTitle("A Quiet Sunday Morning \u2014 An Unscripted Story")).toBe("A Quiet Sunday Morning An Unscripted Story");
    expect(sanitizeTitle("Petite Amateur \u2013 Hardcore Fun")).toBe("Petite Amateur Hardcore Fun");
    expect(sanitizeTitle("Petite Amateur - Hardcore Fun")).toBe("Petite Amateur Hardcore Fun");
  });

  it("keeps a hyphen inside a word", () => {
    expect(sanitizeTitle("Girl-On-Girl Session In Soft Light")).toBe("Girl-On-Girl Session In Soft Light");
  });

  it("removes markdown, emoji, quotes, exclamation marks, and a colon subtitle", () => {
    expect(sanitizeTitle("**Bold Title** With Emphasis")).toBe("Bold Title With Emphasis");
    expect(sanitizeTitle("Hot Scene \u{1F525} Tonight!")).toBe("Hot Scene Tonight");
    expect(sanitizeTitle('"Quoted Title" ')).toBe("Quoted Title");
    expect(sanitizeTitle("Title.")).toBe("Title");
    // "<subject>: <subtitle>" is the same dash-shaped habit in another costume.
    expect(sanitizeTitle("Roleplay: The Naughty Nurse")).toBe("Roleplay The Naughty Nurse");
    expect(sanitizeTitle("Who Is The Boss?")).toBe("Who Is The Boss");
  });

  it("collapses whitespace and caps the length on a word boundary", () => {
    expect(sanitizeTitle("  Too    many   spaces  ")).toBe("Too many spaces");
    const long = sanitizeTitle(Array(60).fill("word").join(" "));
    expect(long.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(long.endsWith("word")).toBe(true);
  });

  it("returns an empty string when nothing publishable is left", () => {
    expect(sanitizeTitle("")).toBe("");
    expect(sanitizeTitle("---")).toBe("");
    expect(sanitizeTitle("\u{1F525}\u{1F525}")).toBe("");
  });
});
