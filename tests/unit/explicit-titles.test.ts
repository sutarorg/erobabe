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
  normalizeDescription,
  titleBands,
  titleNamesSelectedCategory,
  titleWordCount,
  titlesAreTooSimilar,
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
  containsRequiredExplicitTerm,
  copyComplianceViolation,
  normalizeTitleStyle,
  resolveTitleStyle,
  titleKeywordViolation,
  titleWordBudget,
} from "@/lib/metadata/title-style";

/** Categories whose own name must never appear in a published title (see `titleNamesSelectedCategory`). */
const NAME_BANNED_CATEGORIES = KNOWN_CATEGORIES.filter((category) =>
  titleNamesSelectedCategory(category, category),
);

/**
 * The voice the site publishes by default: blunt adult titles that name the act
 * ("My Girlfriend Grabs My Cock For An Intense Raw Doggy Style Fuck In Our
 * Apartment"), not the euphemistic magazine copy an earlier revision produced.
 *
 * Nothing here sets `VIDEO_TITLE_STYLE`, because the point of these tests is
 * what happens with the default configuration.
 */

const SEX_WORD =
  /\b(fuck|fucks|fucked|fucking|sex|cocks?|dicks?|pussy|pussies|ass|tits|boobs|clit|cumshot|creampie|blowjob|anal|slut|whore|orgasm|squirt|nude|naked|hardcore)\b/iu;

function modelReply(fields: Record<string, unknown>) {
  return JSON.stringify({
    title: "My Girlfriend Grabs My Cock For A Raw Doggy Style Fuck",
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
  it("requires this category's own anatomy vocabulary, forbids the category name in the title, and forbids the magazine voice", () => {
    const prompt = buildPrompt({ category: "Amateur" });
    expect(prompt).toContain("porn tube listing, not a film review");
    expect(prompt).toContain(
      "At least one of these words for this category must appear in the title: pussy, cock, dick, boobs, cum, homemade, real couple, raw, creampie, girlfriend.",
    );
    expect(prompt).toContain("Do NOT write euphemisms");
    expect(prompt).toContain('"grabs my cock" is right');
    expect(prompt).toContain('"Amateur"');
    // The listing's category field already carries the category, so the title
    // itself must not spell out the category's own name.
    expect(prompt).toContain("must NOT contain the category name");
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
    const prompt = buildPrompt({ category: "MILF", style: "editorial" });
    expect(prompt).toContain("non-graphic");
    expect(prompt).toContain("4-9 words");
    expect(prompt).toContain("Do not create graphic sexual descriptions");
    expect(prompt).not.toContain("At least one of these words for this category must appear in the title");
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
        title: "Cinema's Candid Boudoir Revelation In Soft Focus For Her",
        description:
          "Amateur cinema listing with a candid editorial voice, clear category context and practical viewing details presented for adults before playback begins on this page today.",
      }),
      "Amateur",
      { style: "explicit", strictWordCount: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/must include one of this category's required words/);
  });

  it("rejects a title that is too short to describe a scene", () => {
    const result = validateSuggestionPayload(modelReply({ title: "Raw Hard Fuck" }), "Amateur", {
      style: "explicit",
      strictWordCount: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/at least 6 words/);
  });

  it("rejects a title that spells out the selected category's own name", () => {
    const result = validateSuggestionPayload(
      modelReply({ title: "My Amateur Girlfriend Grabs My Raw Cock For A Fuck" }),
      "Amateur",
      { style: "explicit", strictWordCount: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/must not spell out the selected category's own name/);
  });

  it("repairs a lenient reply that names the category by stripping the name instead of rejecting it", () => {
    const result = validateSuggestionPayload(
      modelReply({ title: "My Amateur Girlfriend Grabs My Raw Cock For A Fuck" }),
      "Amateur",
      { style: "explicit" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion.title).not.toMatch(/\bamateur\b/iu);
    expect(result.suggestion.title).toMatch(SEX_WORD);
    expect(result.repairs).toContain("category name removed from the title");
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
    expect(titleKeywordViolation("Boudoir Mood In Velvet", "explicit")).toMatch(
      /must include one of this category's required words/,
    );
  });
});

describe("composeExplicitTitle", () => {
  const words = titleWordBudget("explicit");

  it.each([...KNOWN_CATEGORIES])("writes publishable %s titles that leave the category name out", (category) => {
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
      // The listing's category field already carries the category; the title
      // must carry this category's own anatomy vocabulary instead of its name.
      expect(containsRequiredExplicitTerm(title, category), title).toBe(true);
      expect(titleNamesSelectedCategory(title, category), title).toBe(false);
      expect(copyPolicyViolation(title, "", "explicit"), title).toBeNull();
      expect(title, title).not.toMatch(/\b(\w+)\s+\1\b/iu);
      expect(title, title).not.toMatch(/https?:|\.mp4|_\d{4,}/i);
    }
    // A batch of 40 must not collapse onto one canned line.
    expect(seen.size).toBeGreaterThan(12);
  });

  it.each([...NAME_BANNED_CATEGORIES])("never spells out %s as a literal word in the title", (category) => {
    for (let index = 0; index < 15; index += 1) {
      const title = composeExplicitTitle(category, []);
      expect(title, title).not.toMatch(new RegExp(`\\b${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu"));
    }
  });

  it("never repeats a title the queue already used", () => {
    const used: string[] = [];
    for (let index = 0; index < 25; index += 1) used.push(composeExplicitTitle("MILF", used));
    const lowered = used.map((title) => title.toLocaleLowerCase("en"));
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it("treats an unknown category as Amateur rather than failing", () => {
    const title = composeExplicitTitle("Voyeur Collection", []);
    expect(title.length).toBeGreaterThan(30);
    expect(containsRequiredExplicitTerm(title, "Amateur")).toBe(true);
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
    const suggestion = fallbackSuggestion("clip.mp4", "MILF");
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
    expect(phrases.length).toBeGreaterThan(250);
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

describe("repairing an explicit model reply instead of discarding it", () => {
  const sceneDescription = (category: string) =>
    `${category} couch fuck filmed at home: she rides my cock raw, switches to doggy style and takes a creampie on camera. 18+ adults only.`;
  const reply = (title: string, category = "Amateur", description = sceneDescription(category)) =>
    modelReply({ title, category, description });

  it.each([
    // The reported failure: "title must contain at most 16 words".
    [
      "Amateur",
      "My Girlfriend Rides My Cock Raw On The Couch Until I Cum Inside Her Tight Wet Pussy Twice",
      "My Girlfriend Rides My Cock Raw On The Couch",
    ],
    [
      "Amateur",
      "My Wife Grinds Her Pussy On My Cock In The Hammock Until I Cum Inside Her Twice After Midnight",
      "My Wife Grinds Her Pussy On My Cock In The Hammock",
    ],
    [
      "Threesome",
      "Two Babes Share My Two Cocks On The Hotel Bed While I Film Every Second Of Our Wild Fuck",
      "Two Babes Share My Two Cocks On The Hotel Bed",
    ],
    // "Big Ass" is itself a required anatomy term for this category (see
    // `CATEGORY_EXPLICIT_TERMS`), so it is not stripped out as a category label.
    [
      "Big Ass",
      "Big Ass Ebony Babe Bounces On My Dick In Reverse Cowgirl And Twerks Until I Cum All Over Her Huge Booty",
      "Big Ass Ebony Babe Bounces On My Dick In Reverse Cowgirl And Twerks",
    ],
    [
      "POV",
      "Blowjob Then Deepthroat And Facial From My Gorgeous Brunette Girlfriend In Our Tiny Bathroom At Home Tonight",
      "Blowjob Then Deepthroat And Facial From My Gorgeous Brunette Girlfriend In Our Tiny Bathroom",
    ],
  ])("cuts an overlong %s title at a clause boundary that keeps the act in voice", (category, title, expected) => {
    expect(titleWordCount(title)).toBeGreaterThan(titleBands("explicit").words.max);
    const result = validateSuggestionPayload(reply(title, category), category, { style: "explicit" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion.title).toBe(expected);
    expect(titleWordCount(result.suggestion.title)).toBeLessThanOrEqual(titleBands("explicit").words.max);
    expect(result.suggestion.title).toMatch(SEX_WORD);
    expect(titleNamesSelectedCategory(result.suggestion.title, category)).toBe(false);
    expect(result.repairCost).toBe(0);
    expect(result.suggestion.reasoning).toMatch(/title trimmed from \d+ words/);
  });

  it("strips the category's own name out of an otherwise-fine-length title as a repair, not a rejection", () => {
    const result = validateSuggestionPayload(
      reply("My Amateur Girlfriend Rides My Cock Raw On The Couch"),
      "Amateur",
      { style: "explicit" },
    );
    expect(result).toMatchObject({
      ok: true,
      repairCost: 1,
      suggestion: { title: "My Girlfriend Rides My Cock Raw On The Couch" },
    });
    if (result.ok) expect(result.repairs).toContain("category name removed from the title");
  });

  it("drops a stray magazine clause with the overflow instead of rejecting the reply", () => {
    const result = validateSuggestionPayload(
      reply("My Girlfriend Rides My Cock Raw On The Couch In Soft Focus Until I Cum Inside Her Twice Tonight"),
      "Amateur",
      { style: "explicit" },
    );
    expect(result).toMatchObject({
      ok: true,
      suggestion: { title: "My Girlfriend Rides My Cock Raw On The Couch" },
    });
  });

  it("asks again when no cut keeps the title in voice, and drops the opening only as a last resort", () => {
    const title =
      "Horny Wife Spends The Entire Lazy Sunday Teasing Me Slowly Over Many Hours Before She Finally Begs Me To Fuck Her Raw";
    const standard = validateSuggestionPayload(reply(title), "Amateur", { style: "explicit" });
    expect(standard.ok).toBe(false);
    if (!standard.ok) expect(standard.message).toMatch(/at most 16 words/);

    const lastResort = validateSuggestionPayload(reply(title), "Amateur", { style: "explicit", lenient: true });
    expect(lastResort).toMatchObject({
      ok: true,
      repairCost: 1,
      suggestion: { title: "She Finally Begs Me To Fuck Her Raw" },
    });
  });

  it("never trims banned wording away, even when it sits in the overflow", () => {
    const title =
      "My Girlfriend Rides My Cock Raw On The Couch Until Her Teen Friend Joins In Too Tonight Again";
    for (const lenient of [false, true]) {
      const result = validateSuggestionPayload(reply(title), "Amateur", { style: "explicit", lenient });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/not publishable \(age-ambiguous wording \("Teen"\)\)/);
    }
  });

  it.each([
    // The reported failure: "description must contain 20-25 words".
    "Amateur couch fuck filmed at home: she rides my cock raw, switches to doggy style, takes it deep and hard, then finishes with a creampie on camera while she moans my name loudly. 18+ adults only.",
    "Amateur couch fuck filmed at home: she rides my cock raw until I cum.",
  ])("brings a description outside 20-25 words into range: %s", (description) => {
    const words = descriptionWordCount(description);
    expect(words < MIN_DESCRIPTION_WORDS || words > MAX_DESCRIPTION_WORDS).toBe(true);
    const result = validateSuggestionPayload(
      reply("My Girlfriend Rides My Cock Raw On The Couch", "Amateur", description),
      "Amateur",
      { style: "explicit" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isValidDescription(result.suggestion.description)).toBe(true);
    expect(result.suggestion.description.startsWith("Amateur couch fuck filmed at home")).toBe(true);
    expect(result.suggestion.description).not.toMatch(/Review the|listing details|Browse related/);
    expect(result.repairCost).toBe(0);
  });

  it.each([...KNOWN_CATEGORIES])("extends every short %s description with claim-free explicit sentences", (category) => {
    for (let count = 8; count <= 60; count += 1) {
      const result = normalizeDescription(Array(count).fill("word").join(" "), category, "explicit");
      expect(result, `${count} words`).not.toBeNull();
      expect(isValidDescription(result!.description), `${count} words → ${result!.description}`).toBe(true);
      expect(result!.description).not.toMatch(/Review the|listing details|Browse related|For adult viewers/);
      expect(copyPolicyViolation("", result!.description, "explicit")).toBeNull();
    }
  });

  it("works a category the description forgot into the description only, never into the title", () => {
    const forgetful = modelReply({
      title: "My Girlfriend Rides My Dick Raw On The Couch",
      description:
        "She rides my dick raw on the couch, bouncing hard until I cum deep inside her. 18+ adults only, one take, filmed at home.",
      category: "Big Ass",
    });
    const standard = validateSuggestionPayload(forgetful, "Big Ass", { style: "explicit" });
    expect(standard.ok).toBe(false);
    if (!standard.ok) expect(standard.message).toMatch(/opening description must use the selected category/);

    const lastResort = validateSuggestionPayload(forgetful, "Big Ass", { style: "explicit", lenient: true });
    expect(lastResort).toMatchObject({
      ok: true,
      repairCost: 1,
      // The title is already clean (no category label, a valid anatomy word):
      // only the description, which forgot the category, is repaired.
      suggestion: { title: "My Girlfriend Rides My Dick Raw On The Couch" },
    });
    if (lastResort.ok) {
      expect(lastResort.suggestion.description).toMatch(/^Big Ass scene: She rides my dick raw/);
      expect(isValidDescription(lastResort.suggestion.description)).toBe(true);
      expect(lastResort.repairs).toContain("category added to the description");
    }

    const threesome = validateSuggestionPayload(
      modelReply({
        title: "Two Babes Share My Two Cocks On The Hotel Bed",
        description:
          "Fuck tape: two babes share my cock on the hotel bed and take turns riding it until I cum. All performers are 18+.",
        category: "Threesome",
      }),
      "Threesome",
      { style: "explicit", lenient: true },
    );
    expect(threesome).toMatchObject({
      ok: true,
      repairCost: 1,
      suggestion: { title: "Two Babes Share My Two Cocks On The Hotel Bed" },
    });
    if (threesome.ok) {
      expect(threesome.suggestion.description).toMatch(/^Threesome scene:/);
      expect(threesome.repairs).toContain("category added to the description");
    }
  });

  it("completes a short title with the setting its own description names", () => {
    const result = validateSuggestionPayload(
      reply(
        "Raw Girlfriend Fucks Hard",
        "Amateur",
        "Amateur girlfriend fucks hard at home on camera and takes a messy cumshot to finish the scene. 18+ adults only, one take.",
      ),
      "Amateur",
      { style: "explicit", lenient: true },
    );
    expect(result).toMatchObject({ ok: true, repairCost: 1, suggestion: { title: "Raw Girlfriend Fucks Hard On Camera" } });
    expect(validateSuggestionPayload(reply("Raw Girlfriend Fucks Hard"), "Amateur", { style: "explicit" }).ok).toBe(false);
  });

  it("composes a description only for a title that needed no repair of its own", () => {
    const thin = validateSuggestionPayload(
      reply("My Girlfriend Rides My Cock Raw On The Couch", "Amateur", "Too thin."),
      "Amateur",
      { style: "explicit", lenient: true },
    );
    expect(thin).toMatchObject({ ok: true, repairCost: 1, suggestion: { title: "My Girlfriend Rides My Cock Raw On The Couch" } });
    if (thin.ok) {
      expect(isValidDescription(thin.suggestion.description)).toBe(true);
      expect(hasSelectedCategorySignal(thin.suggestion.description.split(" ").slice(0, 12).join(" "), "Amateur")).toBe(true);
    }

    // No description at all, but a clean title that needs no repair of its own:
    // the lenient voice composes a description rather than discarding the reply.
    const titleOnly = validateSuggestionPayload(
      JSON.stringify({ title: "My Girlfriend Rides My Cock Raw On The Couch" }),
      "Amateur",
      { style: "explicit", lenient: true },
    );
    expect(titleOnly).toMatchObject({
      ok: true,
      suggestion: { title: "My Girlfriend Rides My Cock Raw On The Couch" },
    });
    if (titleOnly.ok) expect(isValidDescription(titleOnly.suggestion.description)).toBe(true);
  });

  it("replaces an unpublishable description as a last resort, but never an unpublishable title", () => {
    const badDescription = reply(
      "My Girlfriend Rides My Cock Raw On The Couch",
      "Amateur",
      "Amateur fuck at home with my stepsister riding my cock raw on the couch until I cum inside her. 18+ adults only, one take.",
    );
    const standard = validateSuggestionPayload(badDescription, "Amateur", { style: "explicit" });
    expect(standard.ok).toBe(false);
    if (!standard.ok) expect(standard.message).toMatch(/not publishable \(family-role or incest wording \("stepsister"\)\)/);

    const lastResort = validateSuggestionPayload(badDescription, "Amateur", { style: "explicit", lenient: true });
    expect(lastResort).toMatchObject({ ok: true, repairCost: 1 });
    if (lastResort.ok) {
      expect(lastResort.suggestion.description).not.toMatch(/stepsister/i);
      expect(copyPolicyViolation(lastResort.suggestion.title, lastResort.suggestion.description, "explicit")).toBeNull();
    }

    const badTitle = reply("My Stepsister Rides My Cock Raw On The Couch");
    expect(validateSuggestionPayload(badTitle, "Amateur", { style: "explicit", lenient: true }).ok).toBe(false);
  });
});

describe("near-duplicate detection on explicit titles", () => {
  it.each([
    ["Horny Amateur Babe Sucks My Dick Then Takes It Doggy Style In The Shower", "Busty MILF Gets Her Pussy Pounded Doggy Style On The Hotel Bed"],
    ["My Amateur Girlfriend Rides My Cock Raw On The Couch Until I Cum Inside Her", "Big Ass Babe Bounces On My Cock Until I Cum All Over Her Ass"],
    ["Japanese Babe Gives A Sloppy Blowjob Then Rides Cock In Reverse Cowgirl", "Romantic Morning Sex As My Wife Rides My Cock Slow Until She Cums"],
    ["Massage Turns Into A Slippery Oiled Fuck And A Happy Ending Creampie", "Couples Sex Tape Of A Raw Doggy Style Fuck Ending In A Creampie"],
  ])("does not treat a shared stock phrase as a near-duplicate: %s / %s", (left, right) => {
    expect(titlesAreTooSimilar(left, right)).toBe(false);
  });

  it.each([
    ["My Amateur Girlfriend Rides My Cock Raw On The Couch", "My Amateur Girlfriend Rides My Cock Raw On The Bed"],
    ["Busty MILF Gets Her Pussy Pounded Doggy Style On The Hotel Bed", "Busty MILF Gets Pounded Doggy Style On The Hotel Bed"],
    ["Ebony Babe Takes A Deep Creampie On The Couch", "On The Couch Ebony Babe Takes A Deep Creampie"],
  ])("still flags a genuine near-duplicate: %s / %s", (left, right) => {
    expect(titlesAreTooSimilar(left, right)).toBe(true);
  });
});
