import { describe, it, expect, beforeAll } from "vitest";

/**
 * LIVE OpenRouter test — talks to the real API with the real key.
 *
 * It is excluded from `npm test` (see vitest.config.ts). Run it deliberately
 * from a machine with outbound HTTPS to openrouter.ai:
 *
 *   NEXT_PUBLIC_OPENROUTER_API_KEY=sk-or-… npm run test:live
 *
 * The key is a deliberate public client-side build variable — it is compiled
 * into the browser bundle — but it still must never be pasted into an issue,
 * a commit, a doc, or test output. This suite prints no key material.
 *
 * The same check is available to admins at runtime:
 * **Admin → System Health → “Test OpenRouter”**, which runs the identical
 * probe directly in the browser.
 */

const apiKey = String(process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || "").trim();
const suite = apiKey ? describe : describe.skip;

suite("OpenRouter live API", () => {
  beforeAll(() => {
    if (!apiKey) {
      throw new Error("Set NEXT_PUBLIC_OPENROUTER_API_KEY to run the live OpenRouter tests");
    }
    console.log("[live-openrouter] configuration:", {
      configured: true,
      model: "deepseek/deepseek-v3.2",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      keyLength: apiKey.length,
    });
  });

  it("probes the configured key with a tiny request", async () => {
    const { probeOpenRouter } = await import("@/lib/openrouter/browser-client");
    const probe = await probeOpenRouter({ referer: "https://erobabe.com" });
    console.log("[live-openrouter] probe:", { ...probe });
    expect(probe.configured).toBe(true);
    expect(probe.ok, probe.error || "probe failed").toBe(true);
    expect(probe.model).toBe("deepseek/deepseek-v3.2");
  }, 60_000);

  it("generates real metadata for a file name", async () => {
    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    const suggestion = await suggestVideoMetadata(
      { fileName: "Hands_Only.mp4.ts.mp4", category: "Boudoir" },
      { referer: "https://erobabe.com" }
    );
    console.log("[live-openrouter] suggestion:", suggestion);
    expect(suggestion.title.length).toBeGreaterThan(2);
    expect(suggestion.description.length).toBeGreaterThan(0);
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(suggestion.category).toBeTruthy();
    expect(suggestion.reasoning).toMatch(/human review/);
  }, 60_000);

  it("rejects a bogus key with an actionable, secret-free message", async () => {
    const real = process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    const bogus = "sk-or-v1-not-a-real-key-for-testing-000000000000";
    process.env.NEXT_PUBLIC_OPENROUTER_API_KEY = bogus;

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }, { referer: "https://erobabe.com" }).catch(
      (caught) => caught
    );
    process.env.NEXT_PUBLIC_OPENROUTER_API_KEY = real;

    expect(error).toBeInstanceOf(OpenRouterError);
    const message = String((error as Error).message);
    // The key must never be echoed back to the caller or the browser.
    expect(message).not.toContain(bogus);
    expect(JSON.stringify(error)).not.toContain(bogus);
    // Without outbound access the failure is connectivity, not a rejection —
    // only assert the rejection wording when OpenRouter actually answered.
    if (!/reach|network|fetch failed|ENOTFOUND|ECONN|socket|timeout/i.test(message)) {
      expect(message).toMatch(/rejected|401|403/i);
    }
  }, 60_000);
});
