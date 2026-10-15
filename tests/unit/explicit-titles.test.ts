import { afterEach, describe, expect, it } from "vitest";
import {
  KNOWN_CATEGORIES,
  MAX_DESCRIPTION_WORDS,
  MIN_DESCRIPTION_WORDS,
  buildPrompt,
  composeExplicitDescription,
  composeExplicitTitle,
  copyPolicyViolation,
  descriptionWordCount,
  fallbackSuggestion,
  hasSelectedCategorySignal,
  isCompliantCopy,
  isValidDescription,
  titleBands,
  validateSuggestionPayload,
} from "@/lib/metadata/suggestion";
import {
  EXPLICIT_DESCRIPTION_TAILS,
  EXPLICIT_INTENSIFIERS,
  EXPLICIT_PLACES,
  EXPLICIT_TITLE_ARRANGEMENTS,
  EXPLICIT_TITLE_VOCABULARY,
} from "@/lib/metadata/explicit-titles";
import {
  DEFAULT_TITLE_STYLE,
  copyComplianceViolation,
  normalizeTitleStyle,
  resolveTitleStyle,
  titleKeywordViolation,
  titleWordBudget,
} from "@/lib/metadata/title-style";

/**
 * The voice the site publishes by default: blunt adult titles that name the act
 * ("My Girlfriend Grabs My Cock For An Intense Raw Doggy Style Fuck In Our
 * Apartment"), not the euphemistic magazine copy an earlier revision produced.
 *
 * Nothing here sets `VIDEO_TITLE_STYLE`, because the point of these tests is
 * what happens with the default configuration.
 */

const SEX_WORD =
  /\b(fuck|fucks|fucked|fucking|sex|cock|dick|pussy|ass|tits|boobs|clit|cumshot|creampie|blowjob|anal|slut|whore|orgasm|squirt|nude|naked|hardcore)\b/iu;

function modelReply(fields: Record<string, unknown>) {
  return JSON.stringify({
    title: "My Amateur Girlfriend Grabs My Cock For A Raw Doggy Style Fuck",
    description:
      "Amateur fuck filmed at home: she grabs my cock, takes it raw doggy style and cums twice on camera. 18+ adults only, one take.",
    tags: ["amateur", "doggy-style", "4k"],
    category: "Amateur",
    ...fields,
  });
}

afterEach(() => {
  delete process.env.VIDEO_TITLE_STYLE;
});

describe("default title voice", () => {
  it("is explicit when nothing is configured", () => {
    delete process.env.VIDEO_TITLE_STYLE;
    expect(DEFAULT_TITLE_STYLE).toBe("explicit");
    expect(resolveTitleStyle()).toBe("explicit");
    expect(titleBands().words).toEqual(titleWordBudget("explicit"));
  });

  it("maps the configured aliases and ignores nonsense", () => {
    expect(normalizeTitleStyle("EXPLICIT")).toBe("explicit");
    expect(normalizeTitleStyle(" tube ")).toBe("explicit");
    expect(normalizeTitleStyle("editorial")).toBe("editorial");
    expect(normalizeTitleStyle("magazine")).toBe("editorial");
    expect(normalizeTitleStyle("whatever")).toBeNull();
    expect(resolveTitleStyle("whatever")).toBe("explicit");
    expect(resolveTitleStyle("editorial")).toBe("editorial");
  });
});

describe("explicit prompt", () => {
  it("requires the sexual vocabulary and forbids the magazine voice", () => {
    const prompt = buildPrompt({ category: "Amateur" });
    expect(prompt).toContain("porn tube listing, not a film review");
    expect(prompt).toContain("At least one of these must appear in the title: fuck, fucks, fucked, fucking");
    expect(prompt).toContain("cock, dick, pussy, ass, tits, blowjob, cumshot, creampie, anal, bareback");
    expect(prompt).toContain("Do NOT write euphemisms");
    expect(prompt).toContain('"grabs my cock" is right');
    expect(prompt).toContain("At least one of these must appear in the title");
    expect(prompt).toContain('"Amateur"');
    expect(prompt).toContain("6-16 words");
    expect(prompt).toContain("20-25 words");
    // The old instruction is gone: it is what produced the euphemistic titles.
    expect(prompt).not.toContain("non-graphic");
    expect(prompt).not.toContain("Do not create graphic sexual descriptions");
  });

  it("keeps the compliance floor in the prompt", () => {
    const prompt = buildPrompt({ category: "Hardcore" });
    expect(prompt).toContain("Compliance floor, never relaxed");
    expect(prompt).toContain("Never use teen, minor, child");
    expect(prompt).toContain("Never use family or incest wording");
    expect(prompt).toContain("partner who cannot consent");
    expect(prompt).toContain("adminSelectedCategory");
  });

  it("never publishes the youth-coded internal category label", () => {
    const prompt = buildPrompt({ category: "Teen (18+)" });
    expect(prompt).toContain('"18+ Adults Only"');
    expect(prompt).toContain("The selected database label is internal only");
  });

  it("still writes the restrained voice on request", () => {
    const prompt = buildPrompt({ category: "Boudoir", style: "editorial" });
    expect(prompt).toContain("non-graphic");
    expect(prompt).toContain("4-9 words");
    expect(prompt).toContain("Do not create graphic sexual descriptions");
    expect(prompt).not.toContain("At least one of these must appear in the title");
  });
});

describe("explicit validation", () => {
  it("accepts a title that names the act", () => {
    const result = validateSuggestionPayload(modelReply({}), "Amateur", {
      style: "explicit",
      strictWordCount: true,
    });
    expect(result).toMatchObject({
      ok: true,
      suggestion: { category: "Amateur", tags: ["amateur", "doggy-style", "4k"] },
    });
    if (result.ok) {
      expect(result.suggestion.title).toMatch(SEX_WORD);
      expect(result.suggestion.reasoning).toMatch(/human review/);
    }
  });

  it("rejects a euphemistic title instead of publishing a programme note", () => {
    const result = validateSuggestionPayload(
      modelReply({
        title: "Amateur Cinema's Candid Boudoir Revelation In Soft Focus",
        description:
          "Amateur cinema listing with a candid editorial voice, clear category context and practical viewing details presented for adults before playback begins on this page today.",
      }),
      "Amateur",
      { style: "explicit", strictWordCount: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/name the sex plainly/);
  });

  it("rejects a title that is too short to describe a scene", () => {
    const result = validateSuggestionPayload(modelReply({ title: "Raw Amateur Fuck" }), "Amateur", {
      style: "explicit",
      strictWordCount: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/at least 6 words/);
  });

  it("still blocks age-ambiguous, family-role and non-consent wording", () => {
    const blocked = [
      "Teen Slut Takes My Cock Raw In Our Apartment",
      "My Stepmother Grabs My Cock For A Raw Fuck",
      "He Fucks Her While She Is Passed Out Drunk",
      "My 19 Year Old Girlfriend Takes My Cock On Camera",
      "Schoolgirl Blowjob Filmed With A Hidden Camera",
    ];
    for (const title of blocked) {
      const result = validateSuggestionPayload(
        modelReply({ title, description: `Amateur fuck with ${title.toLowerCase()} and nothing else to read here at all.` }),
        "Amateur",
        { style: "explicit", strictWordCount: false },
      );
      expect(result.ok, title).toBe(false);
      if (!result.ok) expect(result.message, title).toMatch(/not publishable/);
    }
  });

  it("names the breached rule so the retry can fix it", () => {
    expect(copyPolicyViolation("My 18 Year Old Babe Takes Cock In Our Apartment", "", "explicit")).toMatch(
      /age claim/,
    );
    expect(copyPolicyViolation("She Takes My Cock", "They were both asleep.", "explicit")).toMatch(
      /non-consensual/,
    );
    expect(copyPolicyViolation("My Girlfriend Takes My Cock", "", "explicit")).toBeNull();
    expect(copyComplianceViolation("My Stepsister Sucks My Cock")).toMatch(/family-role/);
  });

  it("keeps the editorial voice graphic-free while the explicit voice is not", () => {
    const title = "My Girlfriend Grabs My Cock For A Raw Fuck In Our Apartment";
    expect(isCompliantCopy(title, "", "explicit")).toBe(true);
    expect(isCompliantCopy(title, "", "editorial")).toBe(false);
    expect(titleKeywordViolation(title, "editorial")).toMatch(/non-graphic/);
    expect(titleKeywordViolation("Boudoir Mood In Velvet", "explicit")).toMatch(/name the sex plainly/);
  });
});

describe("composeExplicitTitle", () => {
  const words = titleWordBudget("explicit");

  it.each([...KNOWN_CATEGORIES])("writes publishable %s titles", (category) => {
    const vocabulary = EXPLICIT_TITLE_VOCABULARY[category];
    const seen = new Set<string>();
    const batch: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const title = composeExplicitTitle(category, batch);
      batch.push(title);
      seen.add(title.toLocaleLowerCase("en"));

      const count = title.trim().split(/\s+/u).length;
      expect(count, title).toBeGreaterThanOrEqual(words.min);
      expect(count, title).toBeLessThanOrEqual(words.max);
      expect(title.length, title).toBeGreaterThanOrEqual(35);
      expect(title.length, title).toBeLessThanOrEqual(150);
      expect(title, title).toMatch(SEX_WORD);
      // The category check the publish path applies, not a literal phrase: the
      // labels that must never reach a title ("Teen (18+)") are matched on the
      // age-clear wording they publish as.
      expect(hasSelectedCategorySignal(title, category), title).toBe(true);
      expect(copyPolicyViolation(title, "", "explicit"), title).toBeNull();
      expect(title, title).not.toMatch(/\b(\w+)\s+\1\b/iu);
      expect(title, title).not.toMatch(/https?:|\.mp4|_\d{4,}/i);
    }
    // A batch of 40 must not collapse onto one canned line.
    expect(seen.size).toBeGreaterThan(12);
  });

  it("never repeats a title the queue already used", () => {
    const used: string[] = [];
    for (let index = 0; index < 25; index += 1) used.push(composeExplicitTitle("MILF", used));
    const lowered = used.map((title) => title.toLocaleLowerCase("en"));
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it("treats an unknown category as Mature rather than failing", () => {
    const title = composeExplicitTitle("Voyeur Collection", []);
    expect(title.length).toBeGreaterThan(30);
    expect(hasSelectedCategorySignal(title, "Mature")).toBe(true);
    expect(copyPolicyViolation(title, "", "explicit")).toBeNull();
  });

  it("keeps the youth-coded label out of the title it writes", () => {
    for (let index = 0; index < 15; index += 1) {
      const title = composeExplicitTitle("Teen (18+)");
      expect(title).not.toMatch(/\bteen\b/iu);
      expect(title).toMatch(/18\+/);
      expect(copyPolicyViolation(title, "", "explicit")).toBeNull();
    }
  });
});

describe("composeExplicitDescription", () => {
  it.each([...KNOWN_CATEGORIES])("keeps %s inside the published band", (category) => {
    for (let index = 0; index < 12; index += 1) {
      const description = composeExplicitDescription(category);
      const count = descriptionWordCount(description);
      expect(count, description).toBeGreaterThanOrEqual(MIN_DESCRIPTION_WORDS);
      expect(count, description).toBeLessThanOrEqual(MAX_DESCRIPTION_WORDS);
      expect(isValidDescription(description), description).toBe(true);
      expect(copyPolicyViolation("", description, "explicit"), description).toBeNull();
      expect(
        hasSelectedCategorySignal(description.split(/\s+/u).slice(0, 12).join(" "), category),
        description,
      ).toBe(true);
    }
  });
});

describe("fallbackSuggestion in the explicit voice", () => {
  it("replaces filename-derived copy with an explicit draft", () => {
    const suggestion = fallbackSuggestion("IMG_2041_final_v2.mp4", "Amateur", [], "explicit");
    expect(suggestion.category).toBe("Amateur");
    expect(suggestion.title).toMatch(SEX_WORD);
    expect(suggestion.title).not.toMatch(/IMG|2041|final/i);
    expect(suggestion.reasoning).toMatch(/offline explicit title composer/i);
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(isValidDescription(suggestion.description)).toBe(true);
  });

  it("is what the site default produces when the caller passes no voice", () => {
    const suggestion = fallbackSuggestion("clip.mp4", "Boudoir");
    expect(suggestion.title).toMatch(SEX_WORD);
    expect(copyPolicyViolation(suggestion.title, suggestion.description, "explicit")).toBeNull();
  });
});

describe("explicit vocabulary hygiene", () => {
  const stringsOf = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(stringsOf);
    if (value && typeof value === "object")
      return Object.values(value as Record<string, unknown>).flatMap(stringsOf);
    return [];
  };

  it("never stores a phrase that breaches the compliance floor", () => {
    const phrases = [
      ...Object.values(EXPLICIT_TITLE_VOCABULARY).flatMap((entry) => stringsOf(entry)),
      ...EXPLICIT_PLACES,
      ...EXPLICIT_INTENSIFIERS,
      ...EXPLICIT_DESCRIPTION_TAILS,
    ];
    expect(phrases.length).toBeGreaterThan(300);
    for (const phrase of phrases) {
      // "girl", "teen", "young", family nouns and anything implying a partner who
      // cannot consent must never appear in a pool, because a pool word is a
      // word a generated title will publish.
      expect(copyComplianceViolation(phrase), phrase).toBeNull();
    }
  });

  it("gives every arrangement a required sexual term in every rung", () => {
    for (const category of KNOWN_CATEGORIES) {
      const vocabulary = EXPLICIT_TITLE_VOCABULARY[category];
      const slots = {
        subject: vocabulary.subjects[0],
        act: vocabulary.acts[0],
        move: vocabulary.moves[0],
        place: "In Our Apartment",
        closer: vocabulary.closers[0],
        intensifier: "Intense",
        tail: vocabulary.tails[0],
        categoryPhrase: vocabulary.categoryPhrase,
      };
      for (const arrangement of EXPLICIT_TITLE_ARRANGEMENTS) {
        for (const rung of arrangement(slots)) {
          expect(rung.length, rung).toBeGreaterThan(30);
          expect(rung, rung).toMatch(new RegExp(vocabulary.categoryPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"));
        }
      }
    }
  });
});
