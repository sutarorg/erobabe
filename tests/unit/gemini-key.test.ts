import { describe, it, expect, afterEach } from "vitest";
import { geminiApiKey, normalizeGeminiKey, GEMINI_NOT_CONFIGURED_MESSAGE } from "@/lib/gemini/client";

const ORIGINAL = { ...process.env };

afterEach(() => {
  for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"]) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
});

describe("normalizeGeminiKey", () => {
  it("strips whitespace, wrapping quotes, and a pasted NAME= prefix", () => {
    expect(normalizeGeminiKey("  AQ.abcdefghijk  ")).toBe("AQ.abcdefghijk");
    expect(normalizeGeminiKey('"AQ.abcdefghijk"')).toBe("AQ.abcdefghijk");
    expect(normalizeGeminiKey("'AIzaSyabcdefghij'")).toBe("AIzaSyabcdefghij");
    expect(normalizeGeminiKey("GEMINI_API_KEY=AQ.abcdefghijk")).toBe("AQ.abcdefghijk");
  });

  it("treats empty or whitespace-containing values as missing", () => {
    expect(normalizeGeminiKey("")).toBe("");
    expect(normalizeGeminiKey("   ")).toBe("");
    expect(normalizeGeminiKey("AQ.abc def")).toBe("");
    expect(normalizeGeminiKey(undefined)).toBe("");
  });
});

describe("geminiApiKey", () => {
  it("reads GEMINI_API_KEY with quotes removed", () => {
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENAI_API_KEY;
    process.env.GEMINI_API_KEY = '"AQ.quotedkey1234"';
    expect(geminiApiKey()).toBe("AQ.quotedkey1234");
  });

  it("explains where to set the variable when no key is visible", () => {
    expect(GEMINI_NOT_CONFIGURED_MESSAGE).toMatch(/GEMINI_API_KEY server variable/);
    expect(GEMINI_NOT_CONFIGURED_MESSAGE).toMatch(/Supabase secrets are not visible/);
  });
});
