import { describe, expect, it } from "vitest";
import {
  buildCarouselPrompt,
  carouselCopyFromValue,
  carouselCopyNeedsTrim,
  carouselDescriptionFrom,
  carouselTitleFrom,
  clampWords,
  collapseWhitespace,
  countWords,
  fallbackCarouselCopy,
  CAROUSEL_COPY_EXAMPLE,
  CAROUSEL_DESCRIPTION_FALLBACK,
  CAROUSEL_DESCRIPTION_MAX_WORDS,
  CAROUSEL_TITLE_MAX_WORDS,
} from "@/lib/metadata/carousel-copy";

/**
 * The homepage carousel card is two short lines. These tests pin the word
 * budget the admin asked for: a title of at most 5 words and a description of
 * at most 10 words, whatever the model or the listing contains.
 */

const LONG_TITLE =
  "I Catch My Stepsister-in-law Touching My Cock in the Tent";
const LONG_DESCRIPTION =
  "A slow, explicit late-night scene where she takes control and nothing is left to the imagination at all.";

describe("carousel word budget", () => {
  it("keeps a title at 5 words and a description at 10 words", () => {
    expect(CAROUSEL_TITLE_MAX_WORDS).toBe(5);
    expect(CAROUSEL_DESCRIPTION_MAX_WORDS).toBe(10);

    expect(countWords(carouselTitleFrom(LONG_TITLE))).toBeLessThanOrEqual(5);
    expect(countWords(carouselDescriptionFrom(LONG_DESCRIPTION))).toBeLessThanOrEqual(10);
  });

  it("cuts a long title without leaving trailing punctuation", () => {
    expect(carouselTitleFrom(LONG_TITLE)).toBe(
      "I Catch My Stepsister-in-law Touching",
    );
    expect(carouselTitleFrom("Seduced by the handsome stranger, again")).toBe(
      "Seduced by the handsome stranger",
    );
  });

  it("collapses newlines and repeated spaces before counting", () => {
    expect(collapseWhitespace("  one\n\ttwo   three ")).toBe("one two three");
    expect(countWords("  one\n\ttwo   three ")).toBe(3);
    expect(clampWords("a\nb   c\n\nd", 3)).toBe("a b c");
  });

  it("strips the wrapping the model likes to add", () => {
    expect(carouselTitleFrom('"Seduced By The Neighbour"')).toBe(
      "Seduced By The Neighbour",
    );
    expect(carouselTitleFrom("**Seduced By The Neighbour**")).toBe(
      "Seduced By The Neighbour",
    );
    expect(carouselDescriptionFrom("Title: She never expected him")).toBe(
      "She never expected him",
    );
  });

  it("keeps short copy untouched and never exceeds its own example", () => {
    expect(carouselTitleFrom("Velvet Nights")).toBe("Velvet Nights");
    expect(countWords(CAROUSEL_COPY_EXAMPLE.title)).toBeLessThanOrEqual(5);
    expect(countWords(CAROUSEL_COPY_EXAMPLE.description)).toBeLessThanOrEqual(10);
  });
});

describe("carousel copy coercion", () => {
  it("accepts a model answer inside the budget", () => {
    const copy = carouselCopyFromValue({
      title: "Seduced By The Neighbour",
      description: "She never expected him to knock tonight",
    });
    expect(copy).toEqual({
      title: "Seduced By The Neighbour",
      description: "She never expected him to knock tonight",
    });
    expect(carouselCopyNeedsTrim({ title: "Seduced By The Neighbour" })).toBe(
      false,
    );
  });

  it("trims an over-long answer instead of throwing it away", () => {
    const raw = { title: LONG_TITLE, description: LONG_DESCRIPTION };
    const copy = carouselCopyFromValue(raw);
    expect(countWords(copy!.title)).toBeLessThanOrEqual(5);
    expect(countWords(copy!.description)).toBeLessThanOrEqual(10);
    expect(carouselCopyNeedsTrim(raw)).toBe(true);
  });

  it("accepts common alternative key names and rejects empty answers", () => {
    expect(
      carouselCopyFromValue({ headline: "Velvet Nights", teaser: "The two of us" }),
    ).toEqual({ title: "Velvet Nights", description: "The two of us" });
    expect(carouselCopyFromValue({ title: "Velvet Nights" })).toBeNull();
    expect(carouselCopyFromValue({ description: "Only a teaser" })).toBeNull();
    expect(carouselCopyFromValue("not an object")).toBeNull();
    expect(carouselCopyFromValue(null)).toBeNull();
  });
});

describe("carousel fallback copy", () => {
  it("shortens the listing itself so the card is never empty", () => {
    const copy = fallbackCarouselCopy({
      title: LONG_TITLE,
      description: LONG_DESCRIPTION,
      category: "Mature 18+",
    });
    expect(countWords(copy.title)).toBeLessThanOrEqual(5);
    expect(countWords(copy.description)).toBeLessThanOrEqual(10);
  });

  it("falls back to the category and a default teaser", () => {
    expect(fallbackCarouselCopy({ title: null, description: null, category: "Solo" })).toEqual({
      title: "Solo",
      description: CAROUSEL_DESCRIPTION_FALLBACK,
    });
    expect(fallbackCarouselCopy({}).title).toBe("Featured Scene");
  });
});

describe("carousel prompt", () => {
  const prompt = buildCarouselPrompt({
    title: LONG_TITLE,
    description: LONG_DESCRIPTION,
    category: "Mature 18+",
  });

  it("states both word limits and the JSON shape", () => {
    expect(prompt).toContain("never more than 5 words");
    expect(prompt).toContain("never more than 10 words");
    expect(prompt).toMatch(/Return only a JSON object with the keys title and description/);
  });

  it("treats the listing as untrusted data and keeps the legal guardrails", () => {
    expect(prompt).toMatch(/untrusted source data/i);
    expect(prompt).toMatch(/consenting adult aged 18 or over/i);
    expect(prompt).toMatch(/Never mention or imply minors/i);
  });
});
