import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "./helpers/fake-supabase";

/**
 * Tests for the OpenRouter metadata client and its admin-only route. `fetch` is
 * stubbed globally, so no request ever leaves the test process; the route's
 * Supabase client is an in-memory fake.
 */

const TEST_KEY = "sk-or-v1-testkeyabcdef0123456789";

const authState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => authState.client,
}));

import {
  DEFAULT_OPENROUTER_MODEL,
  MetadataError,
  normalizeOpenRouterKey,
  openRouterDiagnostics,
  OPENROUTER_ENDPOINT,
  OPENROUTER_NOT_CONFIGURED_MESSAGE,
  probeOpenRouter,
  suggestCarouselCopy,
  suggestVideoMetadata,
} from "@/lib/metadata/openrouter";
import { POST as suggest } from "@/app/api/metadata/suggest/route";
import { titlesAreTooSimilar } from "@/lib/metadata/suggestion";

const SUGGEST_URL = "https://erobabe.vercel.app/api/metadata/suggest";

const fetchMock = vi.fn();

function modelOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Boudoir in Velvet After Dark",
    description: "A refined adult boudoir portrait captured in soft cinematic light, with thoughtful composition and visual atmosphere. Browse this collection to discover related video listings.",
    tags: ["mature", "boudoir", "4k"],
    category: "Boudoir",
    ...overrides,
  });
}

function chatReply(content: string, finishReason = "stop") {
  return jsonResponse(200, { choices: [{ message: { content }, finish_reason: finishReason }] });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sentBody(callIndex = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

function seedAuth(
  userId: string | null,
  profile?: Record<string, unknown> | null,
  videos: Array<Record<string, unknown>> = [],
) {
  const fake = createFakeSupabase({
    profiles: userId && profile !== null ? [{ id: userId, role: "admin", status: "active", ...(profile || {}) }] : [],
    videos,
  });
  authState.client = {
    ...fake.client,
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
  };
}

function suggestRequest(body: unknown) {
  return new NextRequest(SUGGEST_URL, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.OPENROUTER_API_KEY = TEST_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MAX_OUTPUT_TOKENS;
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MAX_OUTPUT_TOKENS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeOpenRouterKey", () => {
  it("strips whitespace, wrapping quotes, and a pasted NAME= prefix", () => {
    expect(normalizeOpenRouterKey("  sk-or-v1-abc123  ")).toBe("sk-or-v1-abc123");
    expect(normalizeOpenRouterKey('"sk-or-v1-abc123"')).toBe("sk-or-v1-abc123");
    expect(normalizeOpenRouterKey("OPENROUTER_API_KEY=sk-or-v1-abc123")).toBe("sk-or-v1-abc123");
  });

  it("treats empty or whitespace-containing values as missing", () => {
    expect(normalizeOpenRouterKey("")).toBe("");
    expect(normalizeOpenRouterKey("   ")).toBe("");
    expect(normalizeOpenRouterKey("sk-or-v1 abc")).toBe("");
    expect(normalizeOpenRouterKey(undefined)).toBe("");
  });

  it("explains where to set the variable when no key is visible", () => {
    expect(OPENROUTER_NOT_CONFIGURED_MESSAGE).toMatch(/OPENROUTER_API_KEY server variable/);
    expect(OPENROUTER_NOT_CONFIGURED_MESSAGE).toMatch(/Supabase secrets are not visible/);
  });
});

describe("suggestVideoMetadata", () => {
  it("returns a validated suggestion from model output", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(suggestion).toMatchObject({
      title: "Boudoir in Velvet After Dark",
      tags: ["mature", "boudoir", "4k"],
      category: "Boudoir",
    });
    expect(suggestion.reasoning).toMatch(/human review/);
  });

  it("posts to the OpenRouter chat endpoint with bearer auth", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENROUTER_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_KEY}`);
  });

  it("uses DeepSeek V3.2 by default with reasoning disabled and JSON mode requested", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    const body = sentBody();
    expect(DEFAULT_OPENROUTER_MODEL).toBe("deepseek/deepseek-v3.2");
    expect(body.model).toBe("deepseek/deepseek-v3.2");
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(2048);
  });

  it("honours OPENROUTER_MODEL and OPENROUTER_MAX_OUTPUT_TOKENS", async () => {
    process.env.OPENROUTER_MODEL = "deepseek/deepseek-chat";
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS = "1024";
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(sentBody()).toMatchObject({ model: "deepseek/deepseek-chat", max_tokens: 1024 });
  });

  it("treats source data as untrusted and keeps the guardrails in the prompt", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    const messages = sentBody().messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toMatch(/untrusted source data/i);
    // Whatever the model writes, the prompt holds the legal line.
    expect(messages[0].content).toMatch(/adults-only/i);
    expect(messages[0].content).toMatch(/sexualized youth/i);
  });

  it("anchors copy on the admin category, randomizes the editorial voice, and ignores filename metadata", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ category: "Boudoir" })));
    await suggestVideoMetadata({ fileName: "evening_in_velvet.mp4", category: "Boudoir" });
    const messages = sentBody().messages as Array<{ content: string }>;
    expect(messages[0].content).toContain('Category must be exactly "Boudoir"');
    expect(messages[0].content).toContain("4-9 words");
    expect(messages[0].content).toContain("ONLY content signal");
    expect(messages[0].content).toContain("adult boudoir video");
    expect(messages[0].content).toMatch(/Randomized writing direction/);
    expect(messages[0].content).not.toContain("evening_in_velvet.mp4");
    expect(messages[0].content).toMatch(/inventing actions/);
  });

  it("keeps the admin's category when the model answers with a different one", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ category: "Solo" })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(suggestion.category).toBe("Boudoir");
  });

  it("never puts the key in the request body", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(JSON.stringify(sentBody())).not.toContain(TEST_KEY);
  });

  it("fails honestly without calling the network when the key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.status).toBe(503);
    expect(error.code).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once with a larger budget when the first reply is empty", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("   ")).mockResolvedValueOnce(chatReply(modelOutput()));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.title).toBe("Boudoir in Velvet After Dark");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(1).max_tokens).toBe(4096);
  });

  it("retries an incorrect word count with corrective feedback", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ description: "A short catalog description." })))
      .mockResolvedValueOnce(chatReply(modelOutput()));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.description.split(/\s+/)).toHaveLength(24);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const messages = sentBody(1).messages as Array<{ content: string }>;
    expect(messages[0].content).toContain("previous suggestion failed validation");
    expect(messages[0].content).toContain("description must contain 20-25 words");
  });

  it("rejects repeatedly overlong descriptions without adding invented filler", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description: Array(26).fill("word").join(" ") })));
    await expect(suggestVideoMetadata({ fileName: "clip.mp4" })).rejects.toMatchObject({ code: "bad_output" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not salvage an invalid first response after a network failure", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ description: "Too short." })))
      .mockRejectedValueOnce(new Error("socket hang up"));
    await expect(suggestVideoMetadata({ fileName: "clip.mp4" })).rejects.toBeInstanceOf(MetadataError);
  });

  it("rejects near-duplicate titles after both attempts", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput()));
    await expect(suggestVideoMetadata({ existingTitles: ["Boudoir in Velvet After Dark"] })).rejects.toMatchObject({ code: "bad_output" });
  });

  it("still fails when the model returns nothing a repair can rescue", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description: "Too thin." })));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.code).toBe("bad_output");
    expect(error.message).toContain("20-25 words");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a truncated reply as truncated, not as malformed JSON", async () => {
    fetchMock
      .mockResolvedValueOnce(chatReply("Here is the start of a sugg", "length"))
      .mockResolvedValueOnce(chatReply("Here is the start of a sugg", "length"));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.code).toBe("bad_output");
    expect(error.message).toMatch(/cut off/);
  });

  it("rejects incomplete suggestions with the field named", async () => {
    fetchMock.mockImplementation(async () => chatReply(JSON.stringify({ title: "Only a title" })));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error.code).toBe("bad_output");
    expect(error.message).toMatch(/incomplete/);
  });

  it("surfaces a model refusal as a declined suggestion", async () => {
    fetchMock.mockImplementation(async () => 
      jsonResponse(200, { choices: [{ message: { content: "", refusal: "I can't help with that." }, finish_reason: "stop" }] })
    );
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error.message).toMatch(/declined/);
  });

  it("does not retry quota errors and maps 402 to an out-of-credits message", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(402, { error: { message: "Insufficient credits" } }));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error.status).toBe(429);
    expect(error.code).toBe("quota_exceeded");
    expect(error.message).toMatch(/no credits/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to a quota error without retrying", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(429, { error: { message: "Rate limit" } }));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error.status).toBe(429);
    expect(error.code).toBe("quota_exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 401 to a configuration error", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(401, { error: { message: "No auth credentials found" } }));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error.status).toBe(503);
    expect(error.code).toBe("not_configured");
    expect(error.message).toMatch(/rejected OPENROUTER_API_KEY/);
  });

  it("maps 404 to a model-unavailable error that names the model", async () => {
    process.env.OPENROUTER_MODEL = "vendor/missing-model";
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: { message: "No endpoints found" } }));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error.code).toBe("model_unavailable");
    expect(error.message).toMatch(/vendor\/missing-model/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a server error and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { error: { message: "upstream hiccup" } }))
      .mockResolvedValueOnce(chatReply(modelOutput()));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.category).toBe("Boudoir");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops response_format when the route rejects it, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: "response_format is not supported by this model" } }))
      .mockResolvedValueOnce(chatReply(modelOutput()));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.title).toBe("Boudoir in Velvet After Dark");
    expect(sentBody(0).response_format).toBeDefined();
    expect(sentBody(1).response_format).toBeUndefined();
    expect(sentBody(1).reasoning).toEqual({ enabled: false });
  });

  it("redacts key material echoed back in provider errors", async () => {
    fetchMock.mockImplementation(async () => 
      jsonResponse(500, { error: { message: `bad key sk-or-v1-LeakedSecretMaterial123456 in request` } })
    );
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error.message).not.toContain("LeakedSecretMaterial");
    expect(error.message).toContain("<redacted>");
  });

  it("maps a network failure to a provider error without leaking the key", async () => {
    fetchMock.mockRejectedValue(new Error(`socket reset for ${TEST_KEY}`));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error.code).toBe("provider_error");
    expect(JSON.stringify(error.message)).not.toContain(TEST_KEY);
  });
});

describe("suggestCarouselCopy", () => {
  const SOURCE = {
    title: "I Catch My Stepsister-in-law Touching My Cock in the Tent",
    description: "A slow late-night scene with a lot of explicit detail and camera work.",
    category: "Mature 18+",
  };

  it("asks for two short fields and returns copy inside the card budget", async () => {
    fetchMock.mockResolvedValueOnce(
      chatReply(JSON.stringify({ title: "Seduced By The Neighbour", description: "She never expected him to knock tonight" })),
    );
    const copy = await suggestCarouselCopy(SOURCE);
    expect(copy).toMatchObject({
      title: "Seduced By The Neighbour",
      description: "She never expected him to knock tonight",
      source: "ai",
      trimmed: false,
    });
    const messages = sentBody().messages as Array<{ content: string }>;
    expect(messages[0].content).toMatch(/never more than 5 words/);
    expect(messages[0].content).toMatch(/never more than 10 words/);
    expect(messages[0].content).toMatch(/untrusted source data/i);
    expect(messages[0].content).toMatch(/consenting adult aged 18 or over/i);
  });

  it("trims an over-long answer to 5 words and 10 words instead of failing", async () => {
    fetchMock.mockResolvedValueOnce(
      chatReply(
        JSON.stringify({
          title: "I Catch My Stepsister-in-law Touching My Cock in the Tent",
          description:
            "A slow late-night scene with a lot of explicit detail and camera work for everyone watching right now",
        }),
      ),
    );
    const copy = await suggestCarouselCopy(SOURCE);
    expect(copy.source).toBe("ai");
    expect(copy.trimmed).toBe(true);
    expect(copy.title.split(" ").length).toBeLessThanOrEqual(5);
    expect(copy.description.split(" ").length).toBeLessThanOrEqual(10);
  });

  it("retries once, then shortens the listing itself when the model returns rubbish", async () => {
    fetchMock.mockResolvedValue(chatReply("not json at all"));
    const copy = await suggestCarouselCopy(SOURCE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(copy.source).toBe("fallback");
    expect(copy.title.split(" ").length).toBeLessThanOrEqual(5);
    expect(copy.description.split(" ").length).toBeLessThanOrEqual(10);
    expect(copy.warning).toBeTruthy();
  });

  it("falls back to the listing without a network call when no key is set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const copy = await suggestCarouselCopy(SOURCE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(copy.source).toBe("fallback");
    expect(copy.warning).toBe(OPENROUTER_NOT_CONFIGURED_MESSAGE);
    expect(copy.title).toBe("I Catch My Stepsister-in-law Touching");
  });

  it("never leaks key material when the provider fails", async () => {
    fetchMock.mockImplementation(
      async () => jsonResponse(500, { error: { message: "failed for sk-or-v1-FakeKeyMaterial1234567890" } }),
    );
    const copy = await suggestCarouselCopy(SOURCE);
    expect(copy.source).toBe("fallback");
    expect(JSON.stringify(copy)).not.toContain("FakeKeyMaterial");
  });
});

describe("probeOpenRouter / openRouterDiagnostics", () => {
  it("reports the key shape and model without leaking the key", () => {
    const diagnostics = openRouterDiagnostics();
    expect(diagnostics).toMatchObject({
      configured: true,
      keyKind: "openrouter",
      model: DEFAULT_OPENROUTER_MODEL,
      reasoning: "disabled",
    });
    expect(JSON.stringify(diagnostics)).not.toContain(TEST_KEY);
  });

  it("reports a missing key without a network call", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(openRouterDiagnostics()).toMatchObject({ configured: false, keyKind: "missing" });
    const probe = await probeOpenRouter();
    expect(probe).toMatchObject({ ok: false, configured: false, keyKind: "missing" });
    expect(probe.hint).toMatch(/OPENROUTER_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes the live API and reports success", async () => {
    fetchMock.mockResolvedValueOnce(chatReply("ok"));
    const probe = await probeOpenRouter();
    expect(probe).toMatchObject({ ok: true, model: DEFAULT_OPENROUTER_MODEL });
    expect(sentBody()).toMatchObject({ max_tokens: 32, temperature: 0 });
  });

  it("probes and reports an actionable failure without key material", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(401, { error: { message: "invalid key" } }));
    const probe = await probeOpenRouter();
    expect(probe.ok).toBe(false);
    expect(probe.error).toMatch(/rejected OPENROUTER_API_KEY/);
    expect(probe.hint).toMatch(/openrouter\.ai\/keys/);
    expect(JSON.stringify(probe)).not.toContain(TEST_KEY);
  });
});

describe("POST /api/metadata/suggest", () => {
  it("returns a suggestion to an active admin", async () => {
    seedAuth("admin-1", undefined, [{ title: "Catalog Reference Title" }]);
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));

    const response = await suggest(suggestRequest({ fileName: "clip.mp4", category: "Boudoir" }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.suggestion).toMatchObject({ title: "Boudoir in Velvet After Dark", category: "Boudoir" });
    expect(json.note).toMatch(/human review/);
  });

  it("loads catalog titles for dedupe but never feeds video defaults into AI copy", async () => {
    seedAuth("admin-catalog", undefined, [{ title: "Catalog Reference Title" }]);
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ title: "A Different Boudoir Mood in Focus" })));

    const response = await suggest(suggestRequest({
      fileName: "private_filename.mp4",
      title: "Default uploader title",
      tags: "default tags",
      category: "Boudoir",
    }));
    expect(response.status).toBe(200);
    const content = (sentBody().messages as Array<{ content: string }>)[0].content;
    expect(content).toContain("Catalog Reference Title");
    expect(content).not.toContain("private_filename.mp4");
    expect(content).not.toContain("Default uploader title");
    expect(content).not.toContain("default tags");
  });

  it("serializes parallel admin requests and retries a title reserved by the first request", async () => {
    seedAuth("admin-parallel");
    const firstDraft = modelOutput({ title: "Magenta Boudoir Cinema With Pulse" });
    const secondAngle = modelOutput({ title: "Boudoir Contours in a New Light" });
    fetchMock
      .mockResolvedValueOnce(chatReply(firstDraft))
      .mockResolvedValueOnce(chatReply(firstDraft))
      .mockResolvedValueOnce(chatReply(secondAngle));

    const [firstResponse, secondResponse] = await Promise.all([
      suggest(suggestRequest({ category: "Boudoir" })),
      suggest(suggestRequest({ category: "Boudoir" })),
    ]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const first = (await firstResponse.json()).suggestion.title as string;
    const second = (await secondResponse.json()).suggestion.title as string;
    expect(titlesAreTooSimilar(first, second)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    const response = await suggest(suggestRequest("x".repeat(33 * 1024)));
    expect(response.status).toBe(413);
  });

  it("rate-limits repeated requests", async () => {
    seedAuth("admin-5");
    fetchMock.mockImplementation(async () => chatReply(modelOutput()));
    let lastStatus = 200;
    for (let i = 0; i < 25; i += 1) {
      const response = await suggest(suggestRequest({ fileName: `clip-${i}.mp4` }));
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("returns 503 when OpenRouter is not configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    seedAuth("admin-6");
    const response = await suggest(suggestRequest({ fileName: "clip.mp4" }));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 on quota errors and 502 on provider failures without leaking", async () => {
    seedAuth("admin-7");
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: { message: "Rate limit" } }));
    expect((await suggest(suggestRequest({ fileName: "a.mp4" }))).status).toBe(429);

    seedAuth("admin-8");
    fetchMock.mockImplementation(async () => 
      jsonResponse(500, { error: { message: "failed for sk-or-v1-FakeKeyMaterial1234567890" } })
    );
    const failed = await suggest(suggestRequest({ fileName: "b.mp4" }));
    expect(failed.status).toBe(502);
    const json = await failed.json();
    expect(JSON.stringify(json)).not.toContain("FakeKeyMaterial");
  });
});
