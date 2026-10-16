import { afterEach, describe, expect, it, vi } from "vitest";
import { generateFunnyUsername } from "@/lib/community/anonymous-username";
import { FUNNY_WORDS } from "@/src/utils/funny-words";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("local anonymous usernames", () => {
  it("uses the bundled word library with no API key or network requests", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetch = vi.fn(() => { throw new Error("Network unavailable"); });
    vi.stubGlobal("fetch", fetch);
    const words = new Set(FUNNY_WORDS);
    expect(words.size).toBeGreaterThan(1000);

    for (let i = 0; i < 100; i += 1) {
      const name = generateFunnyUsername();
      expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(name.length).toBeLessThanOrEqual(44);
      const [first, second] = name.toLowerCase().split(" ");
      expect(words.has(first)).toBe(true);
      expect(words.has(second)).toBe(true);
      expect(first).not.toBe(second);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("varies the generated word combinations", () => {
    const names = new Set(Array.from({ length: 100 }, () => generateFunnyUsername()));
    expect(names.size).toBeGreaterThan(90);
  });
});
