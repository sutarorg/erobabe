import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "./helpers/fake-supabase";

/**
 * Tests for the OpenRouter metadata client and its admin-only route. `fetch` is
 * stubbed globally, so no request ever leaves the test process; the route's
 * Supabase client is an in-memory fake.
 */

const TEST_KEY = "sk-or-v1-testkeyabcdef0123456789";

/*
 * These suites drive the provider client and its route with an editorial
 * fixture, so they pin `VIDEO_TITLE_STYLE=editorial` and keep the older
 * expectations meaningful. The site default is `explicit`; the
 * `describe("title voice")` block at the bottom of this file leaves the
 * variable unset and asserts what the install actually does by default.
 */
const CONFIGURED_TITLE_STYLE = process.env.VIDEO_TITLE_STYLE;

const authState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => authState.client,
}));

import {
  DEFAULT_OPENROUTER_FALLBACK_MODELS,
  DEFAULT_OPENROUTER_MODEL,
  MAX_MODEL_ROUTES,
  MIN_ATTEMPT_MS,
  MetadataError,
  MODEL_ATTEMPT_TIMEOUT_MS,
  normalizeOpenRouterKey,
  openRouterDiagnostics,
  openRouterModelChain,
  openRouterRouteHealth,
  OPENROUTER_ENDPOINT,
  OPENROUTER_NOT_CONFIGURED_MESSAGE,
  probeOpenRouter,
  resetOpenRouterModelHealth,
  suggestCarouselCopy,
  suggestVideoMetadata,
} from "@/lib/metadata/openrouter";
import { POST as suggest } from "@/app/api/metadata/suggest/route";
import { isValidDescription, PROMPT_AVOID_LIMIT, titlesAreTooSimilar } from "@/lib/metadata/suggestion";

const SUGGEST_URL = "https://erobabe.vercel.app/api/metadata/suggest";

/**
 * How many requests a rate-limit test may make before giving up on seeing a
 * refusal. The budget itself is an operator decision, so the tests exercise the
 * behaviour rather than restate the number.
 */
const BUDGET_PROBE = 120;

const fetchMock = vi.fn();

function modelOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Amateur in Velvet After Dark",
    description: "A refined adult amateur portrait captured in soft cinematic light, with thoughtful composition and visual atmosphere. Browse this collection to discover related video listings.",
    tags: ["amateur", "hd", "4k"],
    category: "Amateur",
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

/** A PostgREST builder whose every query fails, as during a database outage. */
function failingQuery() {
  const result = { data: null, error: { message: "canceling statement due to statement timeout" } };
  const builder: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "order", "range", "eq", "limit"]) builder[method] = () => builder;
  return builder;
}

function suggestRequest(body: unknown) {
  return new NextRequest(SUGGEST_URL, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  if (CONFIGURED_TITLE_STYLE === undefined) process.env.VIDEO_TITLE_STYLE = "editorial";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.OPENROUTER_API_KEY = TEST_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MAX_OUTPUT_TOKENS;
  delete process.env.OPENROUTER_FALLBACK_MODELS;
  // A route benched by one test must not reorder the chain for the next one.
  resetOpenRouterModelHealth();
});

afterEach(() => {
  if (CONFIGURED_TITLE_STYLE === undefined) delete process.env.VIDEO_TITLE_STYLE;
  else process.env.VIDEO_TITLE_STYLE = CONFIGURED_TITLE_STYLE;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MAX_OUTPUT_TOKENS;
  delete process.env.OPENROUTER_FALLBACK_MODELS;
  resetOpenRouterModelHealth();
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
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" });
    expect(suggestion).toMatchObject({
      title: "Amateur in Velvet After Dark",
      tags: ["amateur", "hd", "4k"],
      category: "Amateur",
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

  it("uses NVIDIA Nemotron 3 Ultra (free) by default with reasoning disabled and JSON mode requested", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    const body = sentBody();
    expect(DEFAULT_OPENROUTER_MODEL).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(body.model).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_completion_tokens).toBe(512);
  });

  it("honours OPENROUTER_MODEL and OPENROUTER_MAX_OUTPUT_TOKENS", async () => {
    process.env.OPENROUTER_MODEL = "deepseek/deepseek-chat";
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS = "1024";
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput()));
    await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(sentBody()).toMatchObject({ model: "deepseek/deepseek-chat", max_completion_tokens: 1024 });
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
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ category: "Amateur" })));
    await suggestVideoMetadata({ fileName: "evening_in_velvet.mp4", category: "Amateur" });
    const messages = sentBody().messages as Array<{ content: string }>;
    expect(messages[0].content).toContain('Category must be exactly "Amateur"');
    expect(messages[0].content).toContain("4-9 words");
    expect(messages[0].content).toContain("ONLY content signal");
    expect(messages[0].content).toContain("adult amateur video");
    expect(messages[0].content).toMatch(/Randomized writing direction/);
    expect(messages[0].content).not.toContain("evening_in_velvet.mp4");
    expect(messages[0].content).toMatch(/inventing actions/);
  });

  it("keeps the admin's category when the model answers with a different one", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ category: "Lesbian" })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" });
    expect(suggestion.category).toBe("Amateur");
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
    expect(suggestion.title).toBe("Amateur in Velvet After Dark");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(1).max_completion_tokens).toBe(1024);
  });

  it("retries an incorrect word count with corrective feedback", async () => {
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ description: "A short catalog description." })))
      .mockResolvedValueOnce(chatReply(modelOutput()));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.description.split(/\s+/)).toHaveLength(24);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(1).max_completion_tokens).toBe(512);
    const messages = sentBody(1).messages as Array<{ content: string }>;
    expect(messages[0].content).toContain("previous suggestion failed validation");
    expect(messages[0].content).toContain("description must contain 20-25 words");
  });

  it("trims an overlong description into range on the first attempt instead of rejecting it", async () => {
    // "description must contain 20-25 words" used to discard the whole reply.
    const description = `Amateur ${Array(33).fill("word").join(" ")}`;
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(suggestion.title).toBe("Amateur in Velvet After Dark");
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.description.startsWith("Amateur word")).toBe(true);
    expect(suggestion.reasoning).toMatch(/trimmed from 34 words/);
  });

  it("names the category at the start of a description only after retries cannot", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description: Array(26).fill("word").join(" ") })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" });
    // Each attempt is asked to fix it first; the repair is the last resort.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(suggestion.title).toBe("Amateur in Velvet After Dark");
    expect(suggestion.description).toMatch(/^Adult amateur video: word word/);
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.reasoning).toMatch(/category added to the description/);
  });

  it("keeps the model's title from an earlier attempt when a later attempt fails", async () => {
    fetchMock
      .mockResolvedValueOnce(chatReply(modelOutput({ description: "Too short." })))
      .mockRejectedValue(new Error("socket hang up"));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" });
    expect(suggestion.title).toBe("Amateur in Velvet After Dark");
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.reasoning).toMatch(/kept after attempt 1 failed validation/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never publishes an exact repeat of an existing title", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput()));
    await expect(suggestVideoMetadata({ existingTitles: ["Amateur in Velvet After Dark"] })).rejects.toMatchObject({ code: "bad_output" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("checks exact repeats against every title but near-duplicates only against the titles the model saw", async () => {
    const title = "Amateur Portrait With Silk Robes and Candle Light";
    const closeVariant = "Amateur Portrait With Silk Robes and Candle Glow";
    expect(titlesAreTooSimilar(title, closeVariant)).toBe(true);
    const shown = Array.from({ length: PROMPT_AVOID_LIMIT }, (_, index) => `Unrelated Listing Number ${index + 1} Of The Archive`);
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ title })));

    // A close variant the model was never shown does not cost the reply.
    const accepted = await suggestVideoMetadata({ category: "Amateur", existingTitles: [...shown, closeVariant] });
    expect(accepted.title).toBe(title);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Among the titles it was shown, it is asked again, and kept as a last resort.
    fetchMock.mockClear();
    const kept = await suggestVideoMetadata({ category: "Amateur", existingTitles: [closeVariant, ...shown] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(kept.title).toBe(title);
    expect(kept.reasoning).toMatch(/close to a recent title/);

    // An exact repeat anywhere in the catalogue is never published.
    fetchMock.mockClear();
    const error = await suggestVideoMetadata({ category: "Amateur", existingTitles: [...shown, title.toUpperCase()] }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.message).toMatch(/duplicates an existing listing/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not start an attempt the route could not finish", async () => {
    const error = await suggestVideoMetadata({ category: "Amateur", deadline: Date.now() + 1000 }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.code).toBe("timeout");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the best earlier reply instead of retrying past the deadline", async () => {
    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return chatReply(modelOutput({ description: "Too short." }));
    });
    const suggestion = await suggestVideoMetadata({ category: "Amateur", deadline: Date.now() + MIN_ATTEMPT_MS + 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(suggestion.title).toBe("Amateur in Velvet After Dark");
    expect(isValidDescription(suggestion.description)).toBe(true);
  });

  it("asks for a real description first, then keeps the title with a composed one", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description: "Too thin." })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retry = (sentBody(1).messages as Array<{ content: string }>)[0].content;
    expect(retry).toContain("description must contain 20-25 words");
    expect(suggestion.title).toBe("Amateur in Velvet After Dark");
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.description).not.toContain("Too thin");
    expect(suggestion.reasoning).toMatch(/description composed in the same voice/);
  });

  it("still fails when the model returns nothing a repair can rescue", async () => {
    // Off-voice for the site default every time: there is no model title to keep.
    process.env.VIDEO_TITLE_STYLE = "explicit";
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description: "Too thin." })));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.code).toBe("bad_output");
    expect(error.message).toMatch(/unusable/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a truncated reply as truncated, not as malformed JSON", async () => {
    fetchMock.mockImplementation(async () => chatReply("Here is the start of a sugg", "length"));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.code).toBe("bad_output");
    expect(error.message).toMatch(/cut off/);
    expect(sentBody(1).max_completion_tokens).toBe(1024);
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
    // A retired preferred slug no longer stops the upload: every fallback route
    // is asked before the caller is told, and only then does the missing model
    // get named so the environment can be corrected.
    expect(fetchMock).toHaveBeenCalledTimes(openRouterModelChain().length);
  });

  it("retries once after a server error and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { error: { message: "upstream hiccup" } }))
      .mockResolvedValueOnce(chatReply(modelOutput()));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.category).toBe("Amateur");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops response_format when the route rejects it, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: "response_format is not supported by this model" } }))
      .mockResolvedValueOnce(chatReply(modelOutput()));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.title).toBe("Amateur in Velvet After Dark");
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

describe("route fallbacks when the preferred model stalls", () => {
  /**
   * A free endpoint that sits in the provider's queue answers nothing at all;
   * without a fallback that silence is what left an upload queue retrying
   * forever on "Waiting for AI title".
   */
  function silentRoute() {
    const error = new Error("The operation was aborted due to timeout");
    error.name = "TimeoutError";
    return error;
  }

  it("drops a silent route and takes the answer from the next one", async () => {
    fetchMock
      .mockRejectedValueOnce(silentRoute())
      .mockResolvedValueOnce(chatReply(modelOutput({ title: "Amateur Kitchen Counter Handheld" })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" });
    expect(suggestion.title).toBe("Amateur Kitchen Counter Handheld");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(sentBody(1).model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODELS[0]);
  });

  it("benches a route that keeps stalling, so later retries start with the fallback", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.model === DEFAULT_OPENROUTER_MODEL) throw silentRoute();
      return chatReply(modelOutput({ title: "Amateur Kitchen Counter Handheld" }));
    });

    // Two requests in a row: the preferred route stalls in both, the fallback
    // carries the draft each time, and the second stall benches the silent one.
    for (let index = 0; index < 2; index += 1) {
      const suggestion = await suggestVideoMetadata({ category: "Amateur" });
      expect(suggestion.title).toBe("Amateur Kitchen Counter Handheld");
    }
    expect(openRouterRouteHealth()[0]).toMatchObject({
      model: DEFAULT_OPENROUTER_MODEL,
      benched: true,
    });

    fetchMock.mockClear();
    const suggestion = await suggestVideoMetadata({ category: "Amateur" });
    expect(sentBody(0).model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODELS[0]);
    expect(suggestion.title).toBe("Amateur Kitchen Counter Handheld");
  });

  it("answers through a fallback when the configured model is gone", async () => {
    process.env.OPENROUTER_MODEL = "vendor/missing-model";
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return body.model === "vendor/missing-model"
        ? jsonResponse(404, { error: { message: "No endpoints found" } })
        : chatReply(modelOutput({ title: "Amateur Hallway Handheld Light" }));
    });
    const suggestion = await suggestVideoMetadata({ category: "Amateur" });
    expect(suggestion.title).toBe("Amateur Hallway Handheld Light");
    expect(sentBody(0).model).toBe("vendor/missing-model");
    expect(sentBody(1).model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODELS[0]);
  });

  it("names the silent route and reports a timeout only after every route stayed silent", async () => {
    fetchMock.mockImplementation(async () => {
      throw silentRoute();
    });
    const error = await suggestVideoMetadata({ category: "Amateur" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.code).toBe("timeout");
    expect(error.message).toMatch(/did not answer in time/);
    expect(error.message).toContain(DEFAULT_OPENROUTER_MODEL);
  });

  it("does not repeat a rejected key, quota refusal, or unreachable host down the chain", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: "invalid key" } }));
    await suggestVideoMetadata({ category: "Amateur" }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("socket reset"));
    const unreachable = await suggestVideoMetadata({ category: "Amateur" }).catch((caught) => caught);
    expect(unreachable.code).toBe("provider_error");
    // The host itself was unreachable, so no fallback route was asked either:
    // another model behind the same endpoint cannot answer that failure.
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => JSON.parse(String((init as RequestInit).body)).model === DEFAULT_OPENROUTER_MODEL,
      ),
    ).toBe(true);
  });

  it("uses the built-in free fallbacks by default, deduplicated and bounded", () => {
    const chain = openRouterModelChain();
    expect(chain[0]).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(chain).toEqual([DEFAULT_OPENROUTER_MODEL, ...DEFAULT_OPENROUTER_FALLBACK_MODELS]);
    expect(new Set(chain).size).toBe(chain.length);
    expect(chain.length).toBeLessThanOrEqual(MAX_MODEL_ROUTES);
  });

  it("honours OPENROUTER_FALLBACK_MODELS, including a deliberately empty list", async () => {
    process.env.OPENROUTER_FALLBACK_MODELS = "vendor/one, vendor/two vendor/one";
    expect(openRouterModelChain()).toEqual([DEFAULT_OPENROUTER_MODEL, "vendor/one", "vendor/two"]);

    process.env.OPENROUTER_FALLBACK_MODELS = "";
    expect(openRouterModelChain()).toEqual([DEFAULT_OPENROUTER_MODEL]);
    // With fallbacks deliberately off, no route the operator did not configure
    // is ever asked for a title.
    fetchMock.mockImplementation(async () => chatReply(modelOutput()));
    await suggestVideoMetadata({ category: "Amateur" });
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => JSON.parse(String((init as RequestInit).body)).model === DEFAULT_OPENROUTER_MODEL,
      ),
    ).toBe(true);
  });
});

describe("explicit title voice (the installed default)", () => {
  it("sends the blunt instruction first and a corrective retry second", async () => {
    process.env.VIDEO_TITLE_STYLE = "explicit";
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ title: "A Velvet Evening After Dark" })));

    const error = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" }).catch((e) => e);
    // The euphemistic fixture is exactly what the site must not publish, so it
    // is rejected rather than quietly accepted.
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.message).toMatch(/required words/);
    const first = (sentBody(0).messages as Array<{ content: string }>)[0].content;
    expect(first).toContain("porn tube listing, not a film review");
    const second = (sentBody(1).messages as Array<{ content: string }>)[0].content;
    expect(second).toContain("adult-tube title that names the sex plainly");
    expect(second).toContain("never uses euphemisms or review language");
  });

  it("returns an error instead of an offline title when the model declines every attempt", async () => {
    process.env.VIDEO_TITLE_STYLE = "explicit";
    // Same catalog row the other route tests expect to see cached.
    seedAuth("admin-explicit", undefined, [{ title: "Catalog Reference Title" }]);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "", refusal: "I can't help with that." }, finish_reason: "stop" }],
      }),
    );

    const response = await suggest(suggestRequest({ fileName: "clip.mp4", category: "Amateur" }));
    // No offline composer: a declined model means an error the admin can retry,
    // never a filler title published without OpenRouter's own work.
    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.error).toMatch(/declined/);
    expect(json.code).toBe("bad_output");
    expect(json.suggestion).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("publishes the model's own draft when it overshoots both budgets (the reported failures)", async () => {
    process.env.VIDEO_TITLE_STYLE = "explicit";
    seedAuth("admin-overshoot");
    const title =
      "My Amateur Wife Grinds On My Cock In The Hammock Until I Cum Inside Her Twice After Midnight Tonight";
    const description =
      "Amateur hammock fuck filmed at home: she grinds on my cock, switches to reverse cowgirl, takes it deep and hard, then finishes with a creampie on camera while moaning. 18+ adults only.";
    expect(title.split(/\s+/).length).toBeGreaterThan(16);
    expect(description.split(/\s+/).length).toBeGreaterThan(25);
    fetchMock.mockImplementation(async () =>
      chatReply(JSON.stringify({ title, description, tags: ["amateur"], category: "Amateur" })),
    );

    const response = await suggest(suggestRequest({ category: "Amateur" }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.source).toBe("ai");
    expect(json).not.toHaveProperty("warning");
    // The category's own name ("Amateur") is stripped from the title as part
    // of the same repair that cuts it back to the word budget.
    expect(json.suggestion.title).toBe(
      "My Wife Grinds On My Cock In The Hammock Until I Cum Inside Her Twice",
    );
    expect(isValidDescription(json.suggestion.description)).toBe(true);
    expect(json.suggestion.description.startsWith("Amateur hammock fuck filmed at home")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


  it("extends a short description in the explicit voice instead of falling back", async () => {
    process.env.VIDEO_TITLE_STYLE = "explicit";
    seedAuth("admin-short-description");
    fetchMock.mockImplementation(async () =>
      chatReply(
        JSON.stringify({
          title: "My Amateur Neighbour Rides My Cock Raw In The Garden Shed",
          description: "Amateur garden shed fuck: she rides my cock raw until I cum inside her.",
          tags: ["amateur"],
          category: "Amateur",
        }),
      ),
    );

    const response = await suggest(suggestRequest({ category: "Amateur" }));
    const json = await response.json();
    expect(json.source).toBe("ai");
    expect(json).not.toHaveProperty("warning");
    expect(isValidDescription(json.suggestion.description)).toBe(true);
    expect(json.suggestion.description).toContain("Watch the full scene from start to finish.");
    expect(json.suggestion.description).not.toMatch(/Review the|listing details/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps refusing to publish an age-ambiguous or coercive title even when explicit", async () => {
    process.env.VIDEO_TITLE_STYLE = "explicit";
    for (const title of [
      "Amateur Teen Girlfriend Takes My Cock Raw In Our Apartment",
      "My Amateur Stepsister Sucks My Cock On The Kitchen Counter",
      "Amateur Babe Takes My Dick After I Slip Her A Drink",
    ]) {
      fetchMock.mockImplementation(async () =>
        chatReply(modelOutput({ title, description: `Amateur sex with ${title.toLowerCase()} and nothing further to add here at all.` })),
      );
      const error = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Amateur" }).catch((e) => e);
      expect(error, title).toBeInstanceOf(MetadataError);
      expect(error.message, title).toMatch(/not publishable/);
    }
  });
});

describe("suggestCarouselCopy", () => {
  const SOURCE = {
    title: "I Catch My Stepsister-in-law Touching My Cock in the Tent",
    description: "A slow late-night scene with a lot of explicit detail and camera work.",
    category: "Hardcore",
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
    expect(sentBody().model).toBe(DEFAULT_OPENROUTER_MODEL);
    const messages = sentBody().messages as Array<{ content: string }>;
    expect(messages[0].content).toMatch(/never more than 5 words/);
    expect(messages[0].content).toMatch(/never more than 10 words/);
    expect(messages[0].content).toMatch(/untrusted source data/i);
    expect(messages[0].content).toMatch(/consenting adult aged 18 or over/i);
    expect(sentBody().max_completion_tokens).toBe(128);
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
      maxOutputTokens: 512,
    });
    expect(JSON.stringify(diagnostics)).not.toContain(TEST_KEY);
  });

  it("reports the route chain and its stalls without leaking the key", () => {
    const diagnostics = openRouterDiagnostics();
    expect(diagnostics.models).toEqual(openRouterModelChain());
    expect(diagnostics.routeTimeoutMs).toBe(MODEL_ATTEMPT_TIMEOUT_MS);
    expect(diagnostics.routeHealth.map((route) => route.model)).toEqual(openRouterModelChain());
    expect(JSON.stringify(diagnostics)).not.toContain(TEST_KEY);
  });

  it("reports the fallback route that answered when the preferred one stalls", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeout).mockResolvedValueOnce(chatReply("ok"));
    const probe = await probeOpenRouter();
    expect(probe).toMatchObject({ ok: true, model: DEFAULT_OPENROUTER_FALLBACK_MODELS[0] });
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
    expect(sentBody()).toMatchObject({ max_completion_tokens: 32, temperature: 0 });
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

    const response = await suggest(suggestRequest({ fileName: "clip.mp4", category: "Amateur" }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.suggestion).toMatchObject({ title: "Amateur in Velvet After Dark", category: "Amateur" });
    expect(json.note).toMatch(/human review/);
    expect(json.source).toBe("ai");
    expect(json).not.toHaveProperty("warning");
    expect(json).not.toHaveProperty("warningCode");
  });

  it("loads catalog titles for dedupe but never feeds video defaults into AI copy", async () => {
    seedAuth("admin-catalog", undefined, [{ title: "Catalog Reference Title" }]);
    fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ title: "A Different Amateur Mood in Focus" })));

    const response = await suggest(suggestRequest({
      fileName: "private_filename.mp4",
      title: "Default uploader title",
      tags: "default tags",
      category: "Amateur",
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
    const firstDraft = modelOutput({ title: "Magenta Amateur Cinema With Pulse" });
    const secondAngle = modelOutput({ title: "Amateur Contours in a Slow New Light" });
    fetchMock
      .mockResolvedValueOnce(chatReply(firstDraft))
      .mockResolvedValueOnce(chatReply(firstDraft))
      .mockResolvedValueOnce(chatReply(secondAngle));

    const [firstResponse, secondResponse] = await Promise.all([
      suggest(suggestRequest({ category: "Amateur" })),
      suggest(suggestRequest({ category: "Amateur" })),
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

  it("rate-limits repeated requests and says when to try again", async () => {
    seedAuth("admin-5");
    // A distinct title per call: with no offline composer to diversify a stuck
    // reply, the model has to be the one supplying fresh titles.
    let counter = 0;
    fetchMock.mockImplementation(async () => {
      counter += 1;
      return chatReply(modelOutput({ title: `Amateur Lace and Linen Number ${counter}` }));
    });
    let allowed = 0;
    let last: Response | null = null;
    // Ask until the route refuses: the exact budget is an operator decision,
    // but it must cover a batch upload drafting several titles per call.
    for (let i = 0; i < BUDGET_PROBE && last?.status !== 429; i += 1) {
      last = await suggest(suggestRequest({ fileName: `clip-${i}.mp4` }));
      if (last.status === 200) allowed += 1;
    }
    expect(allowed).toBeGreaterThanOrEqual(20);
    expect(last?.status).toBe(429);
    const retryAfter = Number(last?.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect((await last!.json()).retryAfter).toBe(retryAfter);
  });

  it("lets a client that waited out Retry-After straight back in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      seedAuth("admin-retry-after");
      let counter = 0;
      fetchMock.mockImplementation(async () => {
        counter += 1;
        return chatReply(modelOutput({ title: `Amateur Lace and Linen Number ${counter}` }));
      });
      let refused: Response | null = null;
      for (let i = 0; i < BUDGET_PROBE && !refused; i += 1) {
        const response = await suggest(suggestRequest({ category: "Amateur" }));
        if (response.status === 429) {
          refused = response;
          break;
        }
        expect(response.status).toBe(200);
      }
      expect(refused).not.toBeNull();
      // Refused requests are not counted, so waiting the advertised time is enough.
      vi.setSystemTime(Date.now() + Number(refused!.headers.get("Retry-After")) * 1000);
      expect((await suggest(suggestRequest({ category: "Amateur" }))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes a whole batch of drafts in one request", async () => {
    seedAuth("admin-batch");
    let counter = 0;
    // A title family nothing else in this file uses: titles reserved by the
    // tests above are still in the avoid list, and a near-duplicate there would
    // make the model answer something else entirely.
    fetchMock.mockImplementation(async () => {
      counter += 1;
      return chatReply(modelOutput({ title: `Slow Motion Studio Portraits Number ${counter}` }));
    });

    const response = await suggest(suggestRequest({ category: "Amateur", count: 3 }));
    expect(response.status).toBe(200);
    const json = await response.json();
    // Three different titles from one request, instead of three requests.
    expect(json.suggestions).toHaveLength(3);
    expect(json.suggestion.title).toBe(json.suggestions[0].title);
    expect(new Set(json.suggestions.map((s: { title: string }) => s.title)).size).toBe(3);
    // One route request for the whole batch: the model may be asked more than
    // once to step off a near-duplicate, but the admin spends one request.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(fetchMock.mock.calls.length).toBeLessThan(9);
  });

  it("refuses a batch larger than one request can answer", async () => {
    seedAuth("admin-batch-limit");
    const response = await suggest(suggestRequest({ category: "Amateur", count: 25 }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not spend the request budget on attempts that failed", async () => {
    seedAuth("admin-outage");
    fetchMock.mockImplementation(async () =>
      jsonResponse(500, { error: { message: "upstream down" } }),
    );
    // A provider outage must not turn the client's automatic retries into a
    // rate-limit lockout: these attempts produced nothing, so they cost nothing.
    for (let i = 0; i < BUDGET_PROBE; i += 1) {
      expect((await suggest(suggestRequest({ category: "Amateur" }))).status).toBe(502);
    }
    // The moment the model answers, the very next request is served.
    let counter = 0;
    fetchMock.mockImplementation(async () => {
      counter += 1;
      return chatReply(modelOutput({ title: `Amateur Light Returns Number ${counter}` }));
    });
    expect((await suggest(suggestRequest({ category: "Amateur" }))).status).toBe(200);
  });

  it("still asks the model when catalog titles cannot be loaded", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Past the brief catalog cache, so the route really queries the database.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      seedAuth("admin-catalog-down");
      const client = authState.client as { from: (table: string) => unknown };
      authState.client = {
        ...client,
        from: (table: string) => (table === "videos" ? failingQuery() : client.from(table)),
      };
      fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ title: "Amateur Lace and Window Light" })));

      const response = await suggest(suggestRequest({ category: "Amateur" }));
      const json = await response.json();
      expect(response.status).toBe(200);
      expect(json.source).toBe("ai");
      expect(json.suggestion.title).toBe("Amateur Lace and Window Light");
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/Catalog titles unavailable/),
        expect.stringMatching(/statement timeout/),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a not-configured error instead of an offline title when OpenRouter is not set up", async () => {
    delete process.env.OPENROUTER_API_KEY;
    seedAuth("admin-6");
    const response = await suggest(suggestRequest({ fileName: "clip.mp4", category: "Amateur" }));
    // No key, no offline composer: the admin gets an actionable error and
    // nothing is published until OPENROUTER_API_KEY is configured.
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.suggestion).toBeUndefined();
    expect(json.error).toMatch(/OPENROUTER_API_KEY/);
    expect(json.code).toBe("not_configured");
  });

  it("surfaces quota and provider failures as errors instead of an offline draft, without leaking", async () => {
    seedAuth("admin-7");
    fetchMock.mockResolvedValue(jsonResponse(429, { error: { message: "Rate limit" } }));
    const limited = await suggest(suggestRequest({ fileName: "a.mp4", category: "Amateur" }));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatch(/quota|credits/i);

    seedAuth("admin-8");
    fetchMock.mockImplementation(async () => 
      jsonResponse(500, { error: { message: "failed for sk-or-v1-FakeKeyMaterial1234567890" } })
    );
    const failed = await suggest(suggestRequest({ fileName: "b.mp4", category: "Amateur" }));
    const json = await failed.json();
    expect(failed.status).toBe(502);
    expect(json.suggestion).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("FakeKeyMaterial");
  });

  it("still returns a draft when the preferred model stays silent", async () => {
    seedAuth("admin-stall");
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.model === DEFAULT_OPENROUTER_MODEL) throw timeout;
      return chatReply(modelOutput({ title: "Amateur Stairwell Handheld Light" }));
    });

    const response = await suggest(suggestRequest({ category: "Amateur" }));

    expect(response.status).toBe(200);
    expect((await response.json()).suggestion.title).toBe("Amateur Stairwell Handheld Light");
  });

  it("honours a per-request editorial voice", async () => {
    seedAuth("admin-style");
    // A title no earlier test in this file has reserved, so the catalog
    // duplicate check cannot push this reply into the offline composer.
    fetchMock.mockImplementation(async () =>
      chatReply(modelOutput({ title: "Amateur Silk Light Study" })),
    );
    const response = await suggest(suggestRequest({ category: "Amateur", style: "editorial" }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.style).toBe("editorial");
    expect(json.suggestion.title).toBe("Amateur Silk Light Study");
  });
});
