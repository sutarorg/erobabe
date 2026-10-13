import { describe, it, expect, beforeAll } from "vitest";
import { geminiDiagnostics, probeGemini, suggestVideoMetadata } from "@/lib/gemini/client";

/**
 * LIVE Gemini test — talks to the real Google API with the real key.
 *
 * It is excluded from `npm test` (see vitest.config.ts). Run it deliberately
 * from a machine with outbound HTTPS to Google:
 *
 *   GEMINI_API_KEY=AQ.… npm run test:live
 *
 * This is the only test that proves a production/beta key works end-to-end;
 * the unit suite mocks the SDK.
 */

const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
const suite = apiKey ? describe : describe.skip;

suite("Gemini live API", () => {
  beforeAll(() => {
    if (!apiKey) {
      throw new Error("Set GEMINI_API_KEY to run the live Gemini tests");
    }
    console.log("[live-gemini] configuration:", geminiDiagnostics());
  });

  it("probes the configured key and reports the endpoint that answered", async () => {
    const probe = await probeGemini();
    console.log("[live-gemini] probe:", probe);
    expect(probe.configured).toBe(true);
    expect(probe.ok, probe.error || "probe failed").toBe(true);
    expect(["gemini", "vertex"]).toContain(probe.backend);
  }, 60_000);

  it("generates real metadata for a file name", async () => {
    const suggestion = await suggestVideoMetadata({ fileName: "Hands_Only.mp4.ts.mp4", category: "Boudoir" });
    console.log("[live-gemini] suggestion:", suggestion);
    expect(suggestion.title.length).toBeGreaterThan(2);
    expect(suggestion.description.length).toBeGreaterThan(0);
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(suggestion.category).toBeTruthy();
  }, 60_000);

  it("rejects a bogus key with an actionable, secret-free message", async () => {
    const real = process.env.GEMINI_API_KEY;
    const bogus = "AQ.Ab8RN6-not-a-real-key-for-testing";
    process.env.GEMINI_API_KEY = bogus;
    // The client caches per key, so the bogus one builds its own client.
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    process.env.GEMINI_API_KEY = real;

    expect(error).toBeInstanceOf(Error);
    const message = String((error as Error).message);
    // The key must never be echoed back to the caller or the browser.
    expect(message).not.toContain(bogus);
    // Without outbound access the failure is connectivity, not a rejection —
    // only assert the rejection wording when Google actually answered.
    if (!/reach|network|fetch failed|ENOTFOUND|ECONN|socket|timeout/i.test(message)) {
      expect(message).toMatch(/rejected|denied|not configured/i);
    }
  }, 60_000);
});
