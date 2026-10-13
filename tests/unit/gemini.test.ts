import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "./helpers/fake-supabase";

/**
 * Tests for the Gemini metadata suggestion client and its admin-only route.
 * The Google SDK is mocked at the module boundary, so no AI request is ever
 * made; the route's Supabase client is an in-memory fake.
 */

const genaiState = vi.hoisted(() => ({
  generateContent: null as null | ((args: Record<string, unknown>) => Promise<Record<string, unknown>>),
  lastArgs: null as null | Record<string, unknown>,
  /** Every client the code constructed, in order (options only — never a key). */
  clientOptions: [] as Record<string, unknown>[],
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (args: Record<string, unknown>) => {
        genaiState.lastArgs = args;
        if (!genaiState.generateContent) throw new Error("generateContent not stubbed");
        return genaiState.generateContent(args);
      },
    };
    constructor(public options: Record<string, unknown>) {
      genaiState.clientOptions.push(options);
    }
  },
  Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY", NUMBER: "NUMBER" },
}));

const authState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => authState.client,
}));

import {
  GeminiError,
  DEFAULT_MAX_OUTPUT_TOKENS,
  fallbackSuggestion,
  geminiDiagnostics,
  humanizeFileName,
  parseLooseJson,
  probeGemini,
  resetGeminiClientForTests,
  suggestVideoMetadata,
} from "@/lib/gemini/client";
import { POST as suggest } from "@/app/api/gemini/suggest/route";

const SUGGEST_URL = "https://erobabe.vercel.app/api/gemini/suggest";

function modelOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    category: "Boudoir",
    ...overrides,
  });
}

function seedAuth(userId: string | null, profile?: Record<string, unknown> | null) {
  const fake = createFakeSupabase({
    profiles: userId && profile !== null ? [{ id: userId, role: "admin", status: "active", ...(profile || {}) }] : [],
  });
  authState.client = {
    ...fake.client,
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
  };
  return fake;
}

function suggestRequest(body: unknown) {
  return new NextRequest(SUGGEST_URL, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  } as any);
}

beforeEach(() => {
  resetGeminiClientForTests();
  genaiState.generateContent = null;
  genaiState.lastArgs = null;
  genaiState.clientOptions = [];
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_API_BACKEND;
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_API_BACKEND;
  vi.restoreAllMocks();
});

describe("suggestVideoMetadata", () => {
  it("returns a validated suggestion from model output", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput() });
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(suggestion).toMatchObject({
      title: "Evening in Velvet",
      description: expect.stringContaining("cinematic light"),
      tags: ["mature", "boudoir", "4k"],
      category: "Boudoir",
    });
    expect(suggestion.reasoning).toMatch(/human review/);
  });

  it("asks for structured JSON with the configured model", async () => {
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    genaiState.generateContent = async () => ({ text: modelOutput() });
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(genaiState.lastArgs).toMatchObject({
      model: "gemini-2.5-flash",
      config: expect.objectContaining({ responseMimeType: "application/json" }),
    });
    const schema = (genaiState.lastArgs?.config as Record<string, unknown>).responseSchema as Record<string, unknown>;
    expect(schema.required).toEqual(["title", "description", "tags", "category"]);
  });

  it("defaults to gemini-flash-latest", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput() });
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(genaiState.lastArgs).toMatchObject({ model: "gemini-flash-latest" });
  });

  it("uses a neutral non-explicit prompt and treats source data as untrusted", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput() });
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    const prompt = String(genaiState.lastArgs?.contents);
    expect(prompt).toMatch(/non-explicit catalog metadata/i);
    expect(prompt).toMatch(/untrusted source data/i);
    expect(prompt).not.toMatch(/adult video platform|pornographic/i);
  });

  it("fails honestly when the API key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    resetGeminiClientForTests();
    let calls = 0;
    genaiState.generateContent = async () => {
      calls += 1;
      return { text: modelOutput() };
    };
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(503);
    expect(error.code).toBe("not_configured");
    expect(calls).toBe(0);
  });

  it("rejects empty model output", async () => {
    genaiState.generateContent = async () => ({ text: "  " });
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(502);
  });

  it("reports blocked prompts without leaking internals", async () => {
    genaiState.generateContent = async () => ({ text: "", promptFeedback: { blockReason: "SAFETY" } });
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.message).toMatch(/declined/i);
  });

  it("rejects malformed JSON", async () => {
    genaiState.generateContent = async () => ({ text: "{not json" });
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("bad_output");
  });

  it("rejects incomplete suggestions", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput({ tags: [] }) });
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(502);
  });

  it("filters tags to the permitted list", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput({ tags: ["Mature", "made-up-tag", "4k", "mature"] }) });
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.tags).toEqual(["mature", "4k"]);
  });

  it("keeps a usable suggestion when the model answers with off-list tags", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput({ tags: ["nope", "alsono"] }) });
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    // The AI title/description survive; tags fall back to the category vocabulary
    // instead of throwing the whole suggestion away.
    expect(suggestion.title).toBe("Evening in Velvet");
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(suggestion.tags).toContain("boudoir");
  });

  it("maps near-miss tags onto the permitted vocabulary", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput({ tags: ["MILF", "girl-on-girl", "4K UHD"] }) });
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.tags).toEqual(["mature", "lesbian", "4k"]);
  });

  it("falls back to a known category for invalid model categories", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput({ category: "Not A Category" }) });
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Solo" });
    expect(suggestion.category).toBe("Solo");
  });

  it("maps quota errors to 429", async () => {
    const quota = new Error("quota exceeded");
    (quota as unknown as Record<string, unknown>).status = 429;
    genaiState.generateContent = async () => {
      throw quota;
    };
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(429);
    expect(error.code).toBe("quota_exceeded");
  });

  it("recognizes Google's HTTP 400 invalid API key response as a configuration error", async () => {
    let calls = 0;
    const denied = new Error('API key not valid. Please pass a valid API key.');
    (denied as unknown as Record<string, unknown>).status = 400;
    genaiState.generateContent = async () => {
      calls += 1;
      throw denied;
    };

    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(503);
    expect(error.code).toBe("not_configured");
    // A rejected key is retried once against the other Google endpoint (Gemini
    // API ↔ Vertex express mode) — that is what makes an AQ. key work.
    expect(calls).toBe(2);
  });

  it("maps auth failures to a configuration error", async () => {
    const denied = new Error("API key not valid");
    (denied as unknown as Record<string, unknown>).status = 403;
    genaiState.generateContent = async () => {
      throw denied;
    };
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(503);
  });

  it("retries an AQ. authorization key rejected by the Gemini API on Vertex express mode", async () => {
    process.env.GEMINI_API_KEY = "AQ.Ab8RN6-test-authorization-key";
    resetGeminiClientForTests();

    const rejected = new Error("API keys are not supported by this API. Expected OAuth2 access token.");
    (rejected as unknown as Record<string, unknown>).status = 401;
    let calls = 0;
    genaiState.generateContent = async () => {
      calls += 1;
      if (calls === 1) throw rejected;
      return { text: modelOutput() };
    };

    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(suggestion.title).toBe("Evening in Velvet");
    expect(calls).toBe(2);
    // The same key is re-sent, but the second client is the express-mode one.
    expect(genaiState.clientOptions[0]).toMatchObject({ apiKey: "AQ.Ab8RN6-test-authorization-key" });
    expect(genaiState.clientOptions[0].vertexai).toBeUndefined();
    expect(genaiState.clientOptions[1]).toMatchObject({ vertexai: true, apiKey: "AQ.Ab8RN6-test-authorization-key" });
  });

  it("honours GEMINI_API_BACKEND=vertex without trying the Gemini API first", async () => {
    process.env.GEMINI_API_BACKEND = "vertex";
    resetGeminiClientForTests();
    genaiState.generateContent = async () => ({ text: modelOutput() });

    await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(genaiState.clientOptions[0]).toMatchObject({ vertexai: true });
  });

  it("falls back to another Flash model when the configured model is unknown", async () => {
    process.env.GEMINI_MODEL = "gemini-does-not-exist";
    resetGeminiClientForTests();

    const missing = new Error("models/gemini-does-not-exist is not found for API version v1beta");
    (missing as unknown as Record<string, unknown>).status = 404;
    let calls = 0;
    genaiState.generateContent = async () => {
      calls += 1;
      if (calls === 1) throw missing;
      return { text: modelOutput() };
    };

    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.title).toBe("Evening in Velvet");
    expect(genaiState.lastArgs).toMatchObject({ model: "gemini-flash-latest" });
  });

  it("parses a fenced JSON block instead of failing", async () => {
    // Models that ignore `responseMimeType` wrap the payload in ```json fences.
    const payload = JSON.stringify({
      title: "Evening in Velvet",
      description: "An elegant portrait in soft light.",
      tags: ["mature", "boudoir"],
      category: "Boudoir",
    });
    genaiState.generateContent = async () => ({ text: `Sure!\n\`\`\`json\n${payload}\n\`\`\`\n` });
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.title).toBe("Evening in Velvet");
    expect(suggestion.tags).toEqual(["mature", "boudoir"]);
  });

  it("salvages a payload cut off by the output token limit", async () => {
    // The regression that produced "Gemini returned malformed JSON": thinking
    // tokens ate the 500-token budget and the JSON stopped mid-object.
    const truncated =
      '{"title":"Evening in Velvet","description":"An elegant portrait in soft light.","tags":["mature","4k"],"category":"Bou';
    genaiState.generateContent = async () => ({
      text: truncated,
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: truncated }] } }],
    });
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(suggestion.title).toBe("Evening in Velvet");
    expect(suggestion.description).toMatch(/soft light/);
    expect(suggestion.tags).toEqual(["mature", "4k"]);
  });

  it("retries once and succeeds when the first response is unparseable", async () => {
    let calls = 0;
    genaiState.generateContent = async () => {
      calls += 1;
      return { text: calls === 1 ? "Here is the metadata (sorry, no JSON): title unknown" : modelOutput() };
    };
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(calls).toBe(2);
    expect(suggestion.title).toBe("Evening in Velvet");
  });

  it("gives the payload a real token budget and keeps thoughts out of it", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput() });
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    const config = genaiState.lastArgs?.config as Record<string, unknown>;
    expect(config.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("drops the thinking config for models that reject it", async () => {
    let calls = 0;
    genaiState.generateContent = async () => {
      calls += 1;
      if (calls === 1) {
        const rejected = new Error("Unknown name \"thinking_budget\": Cannot find field.");
        (rejected as unknown as Record<string, unknown>).status = 400;
        throw rejected;
      }
      return { text: modelOutput() };
    };
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(calls).toBe(2);
    expect(suggestion.title).toBe("Evening in Velvet");
    const config = genaiState.lastArgs?.config as Record<string, unknown>;
    expect(config.thinkingConfig).toBeUndefined();
  });

  it("retries without a response schema when the selected model does not support it", async () => {
    let calls = 0;
    genaiState.generateContent = async () => {
      calls += 1;
      if (calls === 1) {
        const rejected = new Error("Unsupported field: generationConfig.responseSchema");
        (rejected as unknown as Record<string, unknown>).status = 400;
        throw rejected;
      }
      return { text: modelOutput() };
    };

    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(calls).toBe(2);
    expect(suggestion.title).toBe("Evening in Velvet");
    const config = genaiState.lastArgs?.config as Record<string, unknown>;
    expect(config.responseSchema).toBeUndefined();
    expect(config.responseMimeType).toBe("application/json");
  });

  it("retries without JSON mode when the model rejects its MIME type", async () => {
    let calls = 0;
    genaiState.generateContent = async () => {
      calls += 1;
      if (calls === 1) {
        const rejected = new Error("application/json responseMimeType is not supported");
        (rejected as unknown as Record<string, unknown>).status = 400;
        throw rejected;
      }
      return { text: modelOutput() };
    };

    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(calls).toBe(2);
    expect(suggestion.title).toBe("Evening in Velvet");
    const config = genaiState.lastArgs?.config as Record<string, unknown>;
    expect(config.responseSchema).toBeUndefined();
    expect(config.responseMimeType).toBeUndefined();
  });

  it("does not retry quota errors", async () => {
    let calls = 0;
    const quota = new Error("quota exceeded");
    (quota as unknown as Record<string, unknown>).status = 429;
    genaiState.generateContent = async () => {
      calls += 1;
      throw quota;
    };
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(429);
    expect(calls).toBe(1);
  });

  it("accepts tags sent as a comma-separated string", async () => {
    genaiState.generateContent = async () => ({ text: modelOutput({ tags: "mature, 4k" }) });
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.tags).toEqual(["mature", "4k"]);
  });

  it("redacts key material from provider errors", async () => {
    genaiState.generateContent = async () => {
      throw new Error("upstream echoed AQ.FakeKeyMaterial1234567890abcdefghijklmnopqrstuvwxyz nope");
    };
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain("AQ.FakeKeyMaterial");
    expect(error.message).toMatch(/redacted/);
  });
});

describe("geminiDiagnostics / probeGemini", () => {
  it("reports the key shape without leaking the key", () => {
    process.env.GEMINI_API_KEY = "AQ.Ab8RN6-very-secret-value";
    resetGeminiClientForTests();
    const diagnostics = geminiDiagnostics();
    expect(diagnostics.configured).toBe(true);
    expect(diagnostics.keyKind).toBe("authorization");
    expect(JSON.stringify(diagnostics)).not.toContain("very-secret-value");
  });

  it("reports a missing key", () => {
    delete process.env.GEMINI_API_KEY;
    resetGeminiClientForTests();
    const diagnostics = geminiDiagnostics();
    expect(diagnostics.configured).toBe(false);
    expect(diagnostics.keyKind).toBe("missing");
  });

  it("probes the live API and reports the endpoint that answered", async () => {
    genaiState.generateContent = async () => ({ text: "ok" });
    const probe = await probeGemini();
    expect(probe).toMatchObject({ ok: true, configured: true, backend: "gemini", model: "gemini-flash-latest" });
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("probes and reports an actionable failure without key material", async () => {
    process.env.GEMINI_API_KEY = "AQ.Ab8RN6-very-secret-value";
    resetGeminiClientForTests();
    const denied = new Error("API key not valid. Please pass a valid API key.");
    (denied as unknown as Record<string, unknown>).status = 400;
    genaiState.generateContent = async () => {
      throw denied;
    };

    const probe = await probeGemini();
    expect(probe.ok).toBe(false);
    expect(probe.error).toBeTruthy();
    expect(probe.hint).toMatch(/Google AI Studio/);
    expect(JSON.stringify(probe)).not.toContain("very-secret-value");
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
  it("builds reviewable metadata from the file name and category", () => {
    const suggestion = fallbackSuggestion("evening_in_velvet-4k.mov", "Boudoir");
    expect(suggestion.title).toBe("Evening In Velvet 4k");
    expect(suggestion.category).toBe("Boudoir");
    expect(suggestion.tags).toContain("boudoir");
    expect(suggestion.tags.length).toBeGreaterThan(0);
    expect(suggestion.description).toMatch(/review|replace/i);
  });

  it("always lands on a known category and a permitted tag", () => {
    const suggestion = fallbackSuggestion("clip.mp4", "Not A Category");
    expect(suggestion.category).toBe("Mature");
    expect(suggestion.tags.length).toBeGreaterThan(0);
  });

  it("drops long id runs and falls back to the category for empty names", () => {
    expect(fallbackSuggestion("", "Solo").title).toBe("Solo video");
    expect(humanizeFileName("evening_in_velvet_20240512_1080p.mov")).toBe("Evening In Velvet 1080p");
  });
});

describe("POST /api/gemini/suggest", () => {
  it("returns a suggestion to an active admin", async () => {
    seedAuth("admin-1");
    genaiState.generateContent = async () => ({ text: modelOutput() });

    const response = await suggest(suggestRequest({ fileName: "clip.mp4", category: "Boudoir" }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.suggestion).toMatchObject({ title: "Evening in Velvet", category: "Boudoir" });
    expect(json.note).toMatch(/human review/);
  });

  it("requires authentication", async () => {
    seedAuth(null);
    const response = await suggest(suggestRequest({ fileName: "clip.mp4" }));
    expect(response.status).toBe(401);
  });

  it("forbids non-admin users", async () => {
    seedAuth("user-1", { role: "advertiser", status: "active" });
    const response = await suggest(suggestRequest({ fileName: "clip.mp4" }));
    expect(response.status).toBe(403);
  });

  it("forbids inactive admins", async () => {
    seedAuth("admin-2", { role: "admin", status: "suspended" });
    const response = await suggest(suggestRequest({ fileName: "clip.mp4" }));
    expect(response.status).toBe(403);
  });

  it("rejects invalid request bodies", async () => {
    seedAuth("admin-3");
    const response = await suggest(suggestRequest({ title: "x".repeat(500) }));
    expect(response.status).toBe(400);
  });

  it("rejects oversized request bodies", async () => {
    seedAuth("admin-4");
    const response = await suggest(suggestRequest("x".repeat(17 * 1024)));
    expect(response.status).toBe(413);
  });

  it("rate-limits repeated requests", async () => {
    seedAuth("admin-5");
    genaiState.generateContent = async () => ({ text: modelOutput() });
    let lastStatus = 200;
    for (let i = 0; i < 25; i += 1) {
      const response = await suggest(suggestRequest({ fileName: `clip-${i}.mp4` }));
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("returns 503 when Gemini is not configured", async () => {
    delete process.env.GEMINI_API_KEY;
    resetGeminiClientForTests();
    seedAuth("admin-6");
    const response = await suggest(suggestRequest({ fileName: "clip.mp4" }));
    expect(response.status).toBe(503);
  });

  it("returns 429 on quota errors and 502 on provider failures without leaking", async () => {
    seedAuth("admin-7");
    const quota = new Error("Resource exhausted");
    (quota as unknown as Record<string, unknown>).status = 429;
    genaiState.generateContent = async () => {
      throw quota;
    };
    expect((await suggest(suggestRequest({ fileName: "a.mp4" }))).status).toBe(429);

    seedAuth("admin-8");
    genaiState.generateContent = async () => {
      throw new Error("api_key: AIzaFakeKeyMaterial1234567890 broke");
    };
    const failed = await suggest(suggestRequest({ fileName: "b.mp4" }));
    expect(failed.status).toBe(502);
    const json = await failed.json();
    expect(JSON.stringify(json)).not.toContain("AIzaFakeKeyMaterial");
  });
});
