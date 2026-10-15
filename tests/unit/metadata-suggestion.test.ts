import { describe, it, expect } from "vitest";
import { FIXED_CATEGORIES } from "@/lib/public/fixed-categories";
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
  isSafeAdultEditorialCopy,
  parseLooseJson,
  redactKeyMaterial,
  sanitizeGeneratedTitle,
  sanitizeTitle,
  titleWordCount,
  titlesAreTooSimilar,
  validateSuggestionPayload,
} from "@/lib/metadata/suggestion";

/**
 * Provider-neutral metadata helpers: tolerant JSON parsing, payload validation,
 * the deterministic fallback, and redaction. No network and no provider mocks.
 */

function modelOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Boudoir in Velvet After Dark",
    description: "A refined adult boudoir portrait captured in soft cinematic light, with thoughtful composition and visual atmosphere. Browse this collection to discover related video listings.",
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
        title: "Boudoir in Velvet After Dark",
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
  it.each([20, 25])("accepts a description containing %i words", (count) => {
    const description = ["Boudoir", ...Array(count - 1).fill("word")].join(" ");
    const result = validateSuggestionPayload(modelOutput({ description }));
    expect(result.ok).toBe(true);
    expect(descriptionWordCount(description)).toBe(count);
  });

  it("rejects a fragment too thin to repair into a description", () => {
    const result = validateSuggestionPayload(modelOutput({ description: "A short catalog description." }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/description.*20-25 words/);
  });

  it.each([29, 41, 100])("repairs a %i-word description into the published range instead of discarding it", (count) => {
    const description = ["Boudoir", ...Array(count - 1).fill("word")].join(" ");
    const result = validateSuggestionPayload(modelOutput({ description }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isValidDescription(result.suggestion.description)).toBe(true);
      expect(result.suggestion.title).toBe("Boudoir in Velvet After Dark");
      expect(result.suggestion.reasoning).toMatch(/human review/);
    }
  });

  it("keeps the model's own words when it trims an overlong description", () => {
    const firstSentence = `Boudoir ${Array(19).fill("word").join(" ")}`;
    const source = `${firstSentence}. ${Array(31).fill("extra").join(" ")}.`;
    const result = validateSuggestionPayload(modelOutput({ description: source }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(descriptionWordCount(result.suggestion.description)).toBe(20);
      expect(result.suggestion.description.startsWith(firstSentence)).toBe(true);
      // Trimming only ever removes model words; it never substitutes generated ones.
      expect(result.suggestion.description).not.toContain("unhurried");
    }
  });

  it("extends a short description with story sentences for the selected category", () => {
    const short = "Boudoir low light, soft fabric, and a long quiet moment before anything else begins.";
    const boudoir = validateSuggestionPayload(modelOutput({ description: short }), "Boudoir");
    expect(boudoir.ok).toBe(true);
    if (boudoir.ok) {
      expect(isValidDescription(boudoir.suggestion.description)).toBe(true);
      expect(boudoir.suggestion.description.startsWith(short)).toBe(true);
      expect(boudoir.suggestion.reasoning).toMatch(/extended from 14 words/);
    }
  });

  it("prefers the admin's selected category over the category the model returned", () => {
    const result = validateSuggestionPayload(modelOutput({ category: "Solo" }), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.category).toBe("Boudoir");
  });

  it("lets the model choose a category only when the admin chose none", () => {
    const result = validateSuggestionPayload(modelOutput({
      title: "Solo Cinema With a Fresh Perspective",
      description: "Explore adult solo video with a category-focused editorial preview, clear listing details, and practical viewing information for adults browsing this collection online.",
      tags: ["solo", "mature", "editorial"],
      category: "Solo",
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.category).toBe("Solo");
  });

  it("counts irregular and Unicode whitespace consistently and normalizes output", () => {
    expect(descriptionWordCount("  one\n two\tthree\u00a0four  ")).toBe(4);
    expect(descriptionWordCount(" \n ")).toBe(0);
    const words = ["Boudoir", ...Array(21).fill("word")];
    const result = validateSuggestionPayload(modelOutput({ description: words.join(" \n\t") }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.description).toBe(words.join(" "));
  });

  it.each([...KNOWN_CATEGORIES])("keeps fallback descriptions within 20-25 words for %s", (category) => {
    expect(isValidDescription(fallbackSuggestion("clip.mp4", category).description)).toBe(true);
  });

  it("requests factual non-graphic copy with strict budgets and no fabricated stories", () => {
    const prompt = buildPrompt({ fileName: "evening.mp4", category: "Boudoir" });
    expect(prompt).toContain("4-9 words");
    expect(prompt).toContain("20-25 words");
    expect(prompt).toContain("untrusted source data");
    expect(prompt).toContain("not by inventing actions");
    expect(prompt).toContain("non-graphic");
  });

  it("never lets a dash survive into a validated title", () => {
    const payload = { ...JSON.parse(modelOutput()), title: "Boudoir in Velvet \u2014 A Story in Low Light" };
    const result = validateSuggestionPayload(JSON.stringify(payload), "Boudoir");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestion.title).not.toMatch(/[\u2010-\u2015\u2212]/);
      expect(result.suggestion.title).toBe("Boudoir in Velvet A Story in Low Light");
    }
  });

  it.each([...KNOWN_CATEGORIES])("supplies only the requested category %s", (category) => {
    expect(buildPrompt({ category })).toContain(`Category must be exactly ${JSON.stringify(category)}`);
  });

  it.each([...KNOWN_CATEGORIES])("writes a 20-25 word story blurb for %s", (category) => {
    expect(isValidDescription(CATEGORY_STORIES[category].blurb)).toBe(true);
  });
});

describe("fixed admin categories", () => {
  it("supports every live upload category with its own SEO topic and writing voice", () => {
    for (const { label } of FIXED_CATEGORIES) {
      expect(KNOWN_CATEGORIES).toContain(label);
      expect(CATEGORY_STORIES[label as keyof typeof CATEGORY_STORIES].primaryKeyword).toBeTruthy();
      expect(CATEGORY_STORIES[label as keyof typeof CATEGORY_STORIES].titlePool.length).toBeGreaterThan(0);
      expect(buildPrompt({ category: label })).toContain(`Category must be exactly ${JSON.stringify(label)}`);
    }
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
    title: "An Evening in Velvet",
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
    const raw = '{"title":"An Evening in Velvet","description":"An elegant portrait.","tags":["mature","4k"],"category":"Bou';
    const result = parseLooseJson(raw);
    expect(result?.strategy).toBe("truncated-salvage");
    expect(result?.value).toMatchObject({ title: "An Evening in Velvet", tags: ["mature", "4k"] });
  });

  it("returns null when there is no JSON to recover", () => {
    expect(parseLooseJson("I am not able to help with that request.")).toBeNull();
    expect(parseLooseJson("{not json")).toBeNull();
    expect(parseLooseJson("")).toBeNull();
  });
});

describe("fallbackSuggestion", () => {
  it("builds reviewable category-only metadata without using the file name", () => {
    const suggestion = fallbackSuggestion("private_zzunique_991234.mov", "Boudoir");
    expect(suggestion.title).not.toMatch(/private|zzunique|991234/i);
    expect(suggestion.category).toBe("Boudoir");
    expect(suggestion.tags).toContain("boudoir");
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(CATEGORY_STORIES.Boudoir.blurbPool).toContain(suggestion.description);
    expect(suggestion.reasoning).toMatch(/category-only fallback/i);
  });

  it.each([...KNOWN_CATEGORIES])("writes %s category-led metadata within the word budgets", (category) => {
    const suggestion = fallbackSuggestion("evening_in_velvet.mov", category);
    expect(suggestion.category).toBe(category);
    expect(titleWordCount(suggestion.title)).toBeGreaterThanOrEqual(4);
    expect(titleWordCount(suggestion.title)).toBeLessThanOrEqual(9);
    expect(suggestion.title).not.toMatch(/[\u2010-\u2015\u2212-]/);
    expect(CATEGORY_STORIES[category].titlePool).toContain(suggestion.title);
    expect(suggestion.reasoning).toMatch(/requires human review/);
    expect(isValidDescription(suggestion.description)).toBe(true);
  });

  it("chooses a new category-led fallback even after the starter title pool is exhausted", () => {
    const existingTitles = [
      ...CATEGORY_STORIES.Amateur.titlePool,
      "Amateur Cinema With a Neon Pulse",
      "Amateur Cinema With a Velvet Mood",
    ];
    const suggestion = fallbackSuggestion("ignored_filename.mp4", "Amateur", existingTitles);
    expect(titleWordCount(suggestion.title)).toBeGreaterThanOrEqual(4);
    expect(titleWordCount(suggestion.title)).toBeLessThanOrEqual(9);
    expect(existingTitles.some((title) => titlesAreTooSimilar(suggestion.title, title))).toBe(false);
    expect(isSafeAdultEditorialCopy(suggestion.title, suggestion.description)).toBe(true);
  });

  it("always lands on a known category and a permitted tag", () => {
    const suggestion = fallbackSuggestion("clip.mp4", "Not A Category");
    expect(suggestion.category).toBe("Mature");
    expect(suggestion.tags.length).toBeGreaterThan(0);
  });

  it("uses the selected category even when the source file name is empty", () => {
    const suggestion = fallbackSuggestion("", "Solo");
    expect(suggestion.category).toBe("Solo");
    expect(CATEGORY_STORIES.Solo.titlePool).toContain(suggestion.title);
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
    const description = Array(22).fill("word").join(" ");
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
    "lands every repairable length inside 20-25 words for %s",
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

  it.each([8, 12, 17, 18, 19])("extends a %i-word description into range", (count) => {
    const result = normalizeDescription(Array(count).fill("word").join(" "), "Romantic");
    expect(result).not.toBeNull();
    expect(isValidDescription(result!.description)).toBe(true);
    expect(result!.adjusted).toMatch(/^extended from/);
  });

  it("cuts an overlong description on a sentence boundary when it can", () => {
    const source = `${Array(22).fill("word").join(" ")}. ${Array(22).fill("tail").join(" ")}.`;
    const result = normalizeDescription(source, "Romantic");
    expect(result).not.toBeNull();
    expect(descriptionWordCount(result!.description)).toBe(22);
    expect(result!.description).not.toContain("tail");
    expect(result!.adjusted).toMatch(/^trimmed from 44 words/);
  });

  it("trims a single long run-on sentence without breaking a word", () => {
    const result = normalizeDescription(Array(48).fill("word").join(" "), "Romantic");
    expect(result).not.toBeNull();
    expect(descriptionWordCount(result!.description)).toBe(25);
    expect(result!.description.endsWith(".")).toBe(true);
  });

  it("drops a dangling connector left by a hard cut", () => {
    const words = [...Array(24).fill("word"), "and"];
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


describe("category-led generated titles", () => {
  it.each([
    ["Amateur", "Amateur Couple Share A Quiet Evening", "Amateur Couple Share A Quiet Evening"],
    ["Amateur", "A Quiet amateur Evening On Camera", "A Quiet amateur Evening On Camera"],
    ["Mature 18+", "Mature 18+ Performer In Evening Light", "Mature 18+ Performer In Evening Light"],
    ["Solo", "Solomon Enjoys A Quiet Evening", "Solomon Enjoys A Quiet Evening"],
  ])("preserves the selected category signal without stripping substrings (%s)", (category, title, expected) => {
    expect(sanitizeGeneratedTitle(title, category)).toBe(expected);
  });

  it("removes the youth-coded category word from public title copy", () => {
    const result = validateSuggestionPayload(modelOutput({
      title: "Eighteen Plus Adults Only in Focus",
      description: CATEGORY_STORIES["Teen (18+)"].blurb,
      category: "Teen (18+)",
    }), "Teen (18+)");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestion.title).not.toMatch(/\b(?:teen|school|girl|boy)\b/i);
  });

  it.each([29, 41])("rejects %i words under strict validation", (count) => {
    expect(validateSuggestionPayload(modelOutput({ description: Array(count).fill("word").join(" ") }), "Boudoir", { strictWordCount: true }).ok).toBe(false);
  });

  it("uses only the selected category and an exclusion list, never file/default metadata", () => {
    const prompt = buildPrompt({
      title: "DEFAULT TITLE MUST NOT LEAK",
      fileName: "private_filename_must_not_leak.mp4",
      existingTags: "default tags must not leak",
      category: "Amateur",
      existingTitles: ["A Quiet Evening On Camera"],
    }, "Art-house phrasing with a memorable image.");
    expect(prompt).toContain("adminSelectedCategory");
    expect(prompt).toContain("A Quiet Evening On Camera");
    expect(prompt).toContain("Art-house phrasing with a memorable image.");
    expect(prompt).toContain("ONLY content signal");
    expect(prompt).not.toContain("DEFAULT TITLE MUST NOT LEAK");
    expect(prompt).not.toContain("private_filename_must_not_leak.mp4");
    expect(prompt).not.toContain("default tags must not leak");
    expect(prompt).toContain("Do not create graphic sexual descriptions");
  });

  it("rejects near-duplicates while allowing distinct category angles", () => {
    expect(titlesAreTooSimilar("A Velvet Evening in Soft Focus", "Velvet Evening in Soft Focus" )).toBe(true);
    expect(titlesAreTooSimilar("Amateur Cinema With a Confident Editorial Edge", "Amateur Cinema With a Confident Editorial Mood")).toBe(true);
    expect(titlesAreTooSimilar("Amateur Energy With a Cinematic Pulse", "Amateur Energy With a Cinematic Mood")).toBe(true);
    expect(titlesAreTooSimilar("A Velvet Evening in Soft Focus", "Japanese Adult Cinema With a Neon Pulse")).toBe(false);
  });

  it.each([
    "Teen schoolgirl video",
    "My stepmother surprises me",
    "A woman is forced into the scene",
    "Explicit cock and pussy action",
  ])("blocks unsafe category copy: %s", (text) => {
    expect(isSafeAdultEditorialCopy(text, "A restrained adult-only category description." )).toBe(false);
  });

  it("accepts non-graphic copy about clearly adult performers", () => {
    expect(isSafeAdultEditorialCopy("Japanese Adult Cinema With a Neon Pulse", "Browse Japanese adult video with a clear category description for adults exploring this collection online." )).toBe(true);
  });
});
