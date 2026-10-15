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
  DEFAULT_OPENROUTER_MODEL,
  MIN_ATTEMPT_MS,
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
import { isValidDescription, PROMPT_AVOID_LIMIT, titlesAreTooSimilar } from "@/lib/metadata/suggestion";

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
});

afterEach(() => {
  if (CONFIGURED_TITLE_STYLE === undefined) delete process.env.VIDEO_TITLE_STYLE;
  else process.env.VIDEO_TITLE_STYLE = CONFIGURED_TITLE_STYLE;
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

  it("trims an overlong description into range on the first attempt instead of rejecting it", async () => {
    // "description must contain 20-25 words" used to discard the whole reply.
    const description = `Boudoir ${Array(33).fill("word").join(" ")}`;
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(suggestion.title).toBe("Boudoir in Velvet After Dark");
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.description.startsWith("Boudoir word")).toBe(true);
    expect(suggestion.reasoning).toMatch(/trimmed from 34 words/);
  });

  it("names the category at the start of a description only after retries cannot", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description: Array(26).fill("word").join(" ") })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    // Each attempt is asked to fix it first; the repair is the last resort.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(suggestion.title).toBe("Boudoir in Velvet After Dark");
    expect(suggestion.description).toMatch(/^Adult boudoir video: word word/);
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.reasoning).toMatch(/category added to the description/);
  });

  it("keeps the model's title from an earlier attempt when a later attempt fails", async () => {
    fetchMock
      .mockResolvedValueOnce(chatReply(modelOutput({ description: "Too short." })))
      .mockRejectedValue(new Error("socket hang up"));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(suggestion.title).toBe("Boudoir in Velvet After Dark");
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.reasoning).toMatch(/kept after attempt 1 failed validation/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never publishes an exact repeat of an existing title", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput()));
    await expect(suggestVideoMetadata({ existingTitles: ["Boudoir in Velvet After Dark"] })).rejects.toMatchObject({ code: "bad_output" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("checks exact repeats against every title but near-duplicates only against the titles the model saw", async () => {
    const title = "Boudoir Portrait With Silk Robes and Candle Light";
    const closeVariant = "Boudoir Portrait With Silk Robes and Candle Glow";
    expect(titlesAreTooSimilar(title, closeVariant)).toBe(true);
    const shown = Array.from({ length: PROMPT_AVOID_LIMIT }, (_, index) => `Unrelated Listing Number ${index + 1} Of The Archive`);
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ title })));

    // A close variant the model was never shown does not cost the reply.
    const accepted = await suggestVideoMetadata({ category: "Boudoir", existingTitles: [...shown, closeVariant] });
    expect(accepted.title).toBe(title);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Among the titles it was shown, it is asked again, and kept as a last resort.
    fetchMock.mockClear();
    const kept = await suggestVideoMetadata({ category: "Boudoir", existingTitles: [closeVariant, ...shown] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(kept.title).toBe(title);
    expect(kept.reasoning).toMatch(/close to a recent title/);

    // An exact repeat anywhere in the catalogue is never published.
    fetchMock.mockClear();
    const error = await suggestVideoMetadata({ category: "Boudoir", existingTitles: [...shown, title.toUpperCase()] }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.message).toMatch(/duplicates an existing listing/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not start an attempt the route could not finish", async () => {
    const error = await suggestVideoMetadata({ category: "Boudoir", deadline: Date.now() + 1000 }).catch((e) => e);
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.code).toBe("timeout");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the best earlier reply instead of retrying past the deadline", async () => {
    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return chatReply(modelOutput({ description: "Too short." }));
    });
    const suggestion = await suggestVideoMetadata({ category: "Boudoir", deadline: Date.now() + MIN_ATTEMPT_MS + 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(suggestion.title).toBe("Boudoir in Velvet After Dark");
    expect(isValidDescription(suggestion.description)).toBe(true);
  });

  it("asks for a real description first, then keeps the title with a composed one", async () => {
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description: "Too thin." })));
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retry = (sentBody(1).messages as Array<{ content: string }>)[0].content;
    expect(retry).toContain("description must contain 20-25 words");
    expect(suggestion.title).toBe("Boudoir in Velvet After Dark");
    expect(isValidDescription(suggestion.description)).toBe(true);
    expect(suggestion.description).not.toContain("Too thin");
    expect(suggestion.reasoning).toMatch(/description composed in the same voice/);
  });

  it("still fails when the model returns nothing a repair can rescue", async () => {
    // Off-voice for the site default every time: there is no model title to keep.
    process.env.VIDEO_TITLE_STYLE = "explicit";
    fetchMock.mockImplementation(async () => chatReply(modelOutput({ description: "Too thin." })));
    const error = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" }).catch((e) => e);
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

describe("explicit title voice (the installed default)", () => {
  it("sends the blunt instruction first and a corrective retry second", async () => {
    process.env.VIDEO_TITLE_STYLE = "explicit";
    fetchMock.mockImplementation(async () => chatReply(modelOutput()));

    const error = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" }).catch((e) => e);
    // The euphemistic fixture is exactly what the site must not publish, so it
    // is rejected rather than quietly accepted.
    expect(error).toBeInstanceOf(MetadataError);
    expect(error.message).toMatch(/name the sex plainly/);
    const first = (sentBody(0).messages as Array<{ content: string }>)[0].content;
    expect(first).toContain("porn tube listing, not a film review");
    const second = (sentBody(1).messages as Array<{ content: string }>)[0].content;
    expect(second).toContain("adult-tube title that names the sex plainly");
    expect(second).toContain("never uses euphemisms or review language");
  });

  it("publishes an explicit title from the offline composer when the model declines", async () => {
    process.env.VIDEO_TITLE_STYLE = "explicit";
    // Same catalog row the other route tests expect to see cached.
    seedAuth("admin-explicit", undefined, [{ title: "Catalog Reference Title" }]);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "", refusal: "I can't help with that." }, finish_reason: "stop" }],
      }),
    );

    const response = await suggest(suggestRequest({ fileName: "clip.mp4", category: "Boudoir" }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.style).toBe("explicit");
    expect(json.source).toBe("offline");
    expect(json.warning).toMatch(/declined/);
    expect(json.suggestion.title).toMatch(/\b(boudoir)\b/i);
    expect(json.suggestion.title).toMatch(/fuck|cock|dick|pussy|ass|sex|tits|blowjob|creampie|cumshot/i);
    expect(json.suggestion.title).not.toMatch(/cinema|velvet|editorial|mood/i);
    expect(json.suggestion.description.split(/\s+/).length).toBeGreaterThanOrEqual(20);
    expect(json.suggestion.description.split(/\s+/).length).toBeLessThanOrEqual(25);
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
    expect(json.suggestion.title).toBe(
      "My Amateur Wife Grinds On My Cock In The Hammock Until I Cum Inside Her Twice",
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
      "Boudoir Teen Girlfriend Takes My Cock Raw In Our Apartment",
      "My Boudoir Stepsister Sucks My Cock On The Kitchen Counter",
      "Boudoir Babe Takes My Dick After I Slip Her A Drink",
    ]) {
      fetchMock.mockImplementation(async () =>
        chatReply(modelOutput({ title, description: `Boudoir sex with ${title.toLowerCase()} and nothing further to add here at all.` })),
      );
      const error = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" }).catch((e) => e);
      expect(error, title).toBeInstanceOf(MetadataError);
      expect(error.message, title).toMatch(/not publishable/);
    }
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
    expect(json.source).toBe("ai");
    expect(json).not.toHaveProperty("warning");
    expect(json).not.toHaveProperty("warningCode");
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
    const secondAngle = modelOutput({ title: "Boudoir Contours in a Slow New Light" });
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

  it("rate-limits repeated requests and says when to try again", async () => {
    seedAuth("admin-5");
    fetchMock.mockImplementation(async () => chatReply(modelOutput()));
    let last: Response | null = null;
    for (let i = 0; i < 25; i += 1) {
      last = await suggest(suggestRequest({ fileName: `clip-${i}.mp4` }));
    }
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
      fetchMock.mockImplementation(async () => chatReply(modelOutput({ title: "Boudoir Lace and Linen at Noon" })));
      for (let i = 0; i < 20; i += 1) {
        expect((await suggest(suggestRequest({ category: "Boudoir" }))).status).toBe(200);
      }
      const refused = await suggest(suggestRequest({ category: "Boudoir" }));
      expect(refused.status).toBe(429);
      // Refused requests are not counted, so waiting the advertised time is enough.
      vi.setSystemTime(Date.now() + Number(refused.headers.get("Retry-After")) * 1000);
      expect((await suggest(suggestRequest({ category: "Boudoir" }))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
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
      fetchMock.mockResolvedValueOnce(chatReply(modelOutput({ title: "Boudoir Lace and Window Light" })));

      const response = await suggest(suggestRequest({ category: "Boudoir" }));
      const json = await response.json();
      expect(response.status).toBe(200);
      expect(json.source).toBe("ai");
      expect(json.suggestion.title).toBe("Boudoir Lace and Window Light");
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/Catalog titles unavailable/),
        expect.stringMatching(/statement timeout/),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("still answers from the offline composer when OpenRouter is not configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    seedAuth("admin-6");
    const response = await suggest(suggestRequest({ fileName: "clip.mp4", category: "Boudoir" }));
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.source).toBe("offline");
    expect(json.suggestion.title).toBeTruthy();
    expect(json.warning).toMatch(/OPENROUTER_API_KEY/);
    expect(json.warningCode).toBe("not_configured");
  });

  it("answers with an offline draft on quota and provider failures without leaking", async () => {
    seedAuth("admin-7");
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: { message: "Rate limit" } }));
    const limited = await suggest(suggestRequest({ fileName: "a.mp4", category: "Boudoir" }));
    expect(limited.status).toBe(200);
    expect((await limited.json()).warning).toMatch(/quota|credits/i);

    seedAuth("admin-8");
    fetchMock.mockImplementation(async () => 
      jsonResponse(500, { error: { message: "failed for sk-or-v1-FakeKeyMaterial1234567890" } })
    );
    const failed = await suggest(suggestRequest({ fileName: "b.mp4", category: "Boudoir" }));
    const json = await failed.json();
    expect(failed.status).toBe(200);
    expect(json.source).toBe("offline");
    expect(JSON.stringify(json)).not.toContain("FakeKeyMaterial");
  });

  it("honours a per-request editorial voice", async () => {
    seedAuth("admin-style");
    // A title no earlier test in this file has reserved, so the catalog
    // duplicate check cannot push this reply into the offline composer.
    fetchMock.mockImplementation(async () =>
      chatReply(modelOutput({ title: "Boudoir Silk Light Study" })),
    );
    const response = await suggest(suggestRequest({ category: "Boudoir", style: "editorial" }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.style).toBe("editorial");
    expect(json.suggestion.title).toBe("Boudoir Silk Light Study");
  });
});
