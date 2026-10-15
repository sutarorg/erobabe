import { describe, it, expect, beforeAll } from "vitest";
import { isValidDescription, KNOWN_CATEGORIES } from "@/lib/metadata/suggestion";
import { openRouterDiagnostics, probeOpenRouter, suggestVideoMetadata } from "@/lib/metadata/openrouter";

/**
 * LIVE OpenRouter test — talks to the real OpenRouter API with the real key.
 *
 * It is excluded from `npm test` (see vitest.config.ts). Run it deliberately
 * from a machine with outbound HTTPS to openrouter.ai:
 *
 *   OPENROUTER_API_KEY=sk-or-… npm run test:live
 *
 * This is the only test that proves a production key works end-to-end; the
 * unit suite mocks `fetch`.
 */

const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
const suite = apiKey ? describe : describe.skip;

suite("OpenRouter live API", () => {
  beforeAll(() => {
    if (!apiKey) {
      throw new Error("Set OPENROUTER_API_KEY to run the live OpenRouter tests");
    }
    console.log("[live-openrouter] configuration:", openRouterDiagnostics());
  });

  it("probes the configured key and reports the model that answered", async () => {
    const probe = await probeOpenRouter();
    console.log("[live-openrouter] probe:", probe);
    expect(probe.configured).toBe(true);
    expect(probe.ok, probe.error || "probe failed").toBe(true);
  }, 60_000);

  it("generates real metadata for a file name", async () => {
    const suggestion = await suggestVideoMetadata({ fileName: "Hands_Only.mp4.ts.mp4", category: "Boudoir" });
    console.log("[live-openrouter] suggestion:", suggestion);
    expect(suggestion.title.length).toBeGreaterThan(2);
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(suggestion.category).toBeTruthy();
  }, 60_000);

  /**
   * The regression this guards: a description outside 20-25 words, or a title
   * over its word budget, used to discard the whole suggestion and drop the
   * upload back onto offline metadata. Length slips are now repaired. Run this
   * across every category the admin can pick.
   */
  it.each([...KNOWN_CATEGORIES])("returns usable %s metadata, whatever the model does with the word count", async (category) => {
    const suggestion = await suggestVideoMetadata({ fileName: "evening_in_velvet.mp4.ts.mp4", category });
    console.log(`[live-openrouter] ${category}:`, suggestion);
    // The admin's selection is authoritative — the model must not override it.
    expect(suggestion.category).toBe(category);
    expect(isValidDescription(suggestion.description), suggestion.description).toBe(true);
    expect(suggestion.title.length).toBeGreaterThan(2);
    expect(suggestion.title.length).toBeLessThanOrEqual(160);
    expect(suggestion.tags.length).toBeGreaterThan(0);
    // The installed voice is explicit: a title that only hints at the scene is
    // a regression, whatever the model decided to be polite about.
    expect(
      suggestion.title,
      suggestion.title,
    ).toMatch(/fuck|cock|dick|pussy|ass|sex|tits|blowjob|creampie|cumshot|slut|anal|strapon/i);
    expect(suggestion.title).not.toMatch(/cinema|velvet|editorial|revelation/i);
  }, 90_000);

  it("rejects a bogus key with an actionable, secret-free message", async () => {
    const real = process.env.OPENROUTER_API_KEY;
    const bogus = "sk-or-v1-not-a-real-key-for-testing-only";
    process.env.OPENROUTER_API_KEY = bogus;
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    process.env.OPENROUTER_API_KEY = real;

    expect(error).toBeInstanceOf(Error);
    const message = String((error as Error).message);
    // The key must never be echoed back to the caller or the browser.
    expect(message).not.toContain(bogus);
    // Without outbound access the failure is connectivity, not a rejection.
    if (!/reach|network|fetch failed|ENOTFOUND|ECONN|socket|timeout/i.test(message)) {
      expect(message).toMatch(/rejected|denied|not configured/i);
    }
  }, 60_000);
});
