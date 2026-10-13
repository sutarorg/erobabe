import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the browser-only OpenRouter client.
 *
 * Every test mocks `fetch()` — the normal unit suite never spends real API
 * credits. The tests assert the exact endpoint and model, header
 * construction, schema validation, error mapping for 401/403/429/5xx,
 * malformed/empty/truncated payloads, missing key, network failure, timeout
 * and cancellation — and that key material never appears in thrown errors or
 * results.
 */

const TEST_KEY = "sk-or-v1-test-key-material-do-not-leak-abcdef123456";

function chatResponse(content: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: "gen-1",
      model: "deepseek/deepseek-v3.2",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function errorResponse(status: number, message?: string) {
  return new Response(message ? JSON.stringify({ error: { message } }) : JSON.stringify({ error: null }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function validContent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    category: "Boudoir",
    ...overrides,
  });
}

/** A fetch that never resolves until its signal aborts. */
function hangingFetch() {
  return vi.fn((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    })
  );
}

type FetchCall = [string, RequestInit & { headers: Record<string, string> }];

function callsOf(mock: ReturnType<typeof vi.fn>): FetchCall[] {
  return mock.mock.calls as unknown as FetchCall[];
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_OPENROUTER_API_KEY = TEST_KEY;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("request construction", () => {
  it("posts to the exact OpenRouter endpoint with the exact model id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(validContent()));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OPENROUTER_ENDPOINT, OPENROUTER_MODEL } = await import(
      "@/lib/openrouter/browser-client"
    );
    await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = callsOf(fetchMock)[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(OPENROUTER_ENDPOINT).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(OPENROUTER_MODEL).toBe("deepseek/deepseek-v3.2");

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek/deepseek-v3.2");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.temperature).toBeLessThanOrEqual(1);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("builds the authorization header without leaking key material elsewhere", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(validContent()));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    await suggestVideoMetadata({ fileName: "clip.mp4" });

    const [, init] = callsOf(fetchMock)[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Authorization"]).toBe(`Bearer ${TEST_KEY}`);
    // Attribution headers are metadata, never authentication.
    expect(init.headers["X-Title"]).toBe("Erobabe");
    expect(String(init.headers["HTTP-Referer"] ?? "").length).toBeGreaterThan(0);

    // The key must not appear in any stringified output of the response path.
    expect(JSON.stringify(JSON.parse(String(init.body)))).not.toContain(TEST_KEY);
  });

  it("sends only the minimum source data — no full URLs or query strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(validContent()));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    await suggestVideoMetadata({
      fileName: "Hands_Only.mp4.ts.mp4",
      category: "Boudoir",
      title: "Existing title",
      existingTags: "mature, 4k",
    });

    const [, init] = callsOf(fetchMock)[0];
    const body = JSON.parse(String(init.body));
    const userMessage = body.messages.find((message: { role: string }) => message.role === "user").content;
    expect(userMessage).toContain("Hands_Only.mp4.ts.mp4");
    expect(userMessage).toContain("Boudoir");
    expect(userMessage).not.toMatch(/https?:\/\//);
    expect(userMessage).not.toContain("token=");
    // Untrusted-data framing must be present in the prompt.
    const systemMessage = body.messages.find((message: { role: string }) => message.role === "system").content;
    expect(systemMessage).toMatch(/untrusted/i);
    expect(systemMessage).toMatch(/non-clickbait/i);
    expect(systemMessage).toMatch(/never proof of rights, age, or consent/i);
    expect(systemMessage).not.toMatch(/pornographic|adult video platform/i);
  });
});

describe("metadata parsing and validation", () => {
  it("parses and validates a well-formed suggestion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(validContent()));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });

    expect(suggestion).toMatchObject({
      title: "Evening in Velvet",
      description: expect.stringContaining("cinematic light"),
      tags: ["mature", "boudoir", "4k"],
      category: "Boudoir",
    });
    expect(suggestion.reasoning).toMatch(/human review/);
  });

  it("filters off-list tags and normalises categories", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(validContent({ tags: ["MILF", "made-up", "4K UHD", "MILF"], category: "boudoir" })));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(suggestion.tags).toEqual(["mature", "4k"]);
    expect(suggestion.category).toBe("Boudoir");
  });

  it("recovers JSON wrapped in markdown fences and prose", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(`Sure! Here is the metadata:\n\`\`\`json\n${validContent()}\n\`\`\``));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(suggestion.title).toBe("Evening in Velvet");
  });

  it("rejects an empty response and reports bad_output", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(chatResponse("   ")));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("bad_output");
    expect(error.message).not.toContain(TEST_KEY);
  });

  it("rejects malformed JSON after both attempts", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(chatResponse("{not json")));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("bad_output");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("salvages a truncated payload when the completed fields still satisfy the schema", async () => {
    const truncated =
      '{"title":"Evening in Velvet","description":"An elegant portrait in soft light.","tags":["mature","4k"],"cat';
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(truncated));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" });
    expect(suggestion.title).toBe("Evening in Velvet");
    expect(suggestion.tags).toEqual(["mature", "4k"]);
  });

  it("rejects a truncated payload with no recoverable fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('{"title":"Even'));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4", category: "Boudoir" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("bad_output");
    expect(error.message).not.toContain(TEST_KEY);
  });

  it("rejects a response with missing choices", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ model: "deepseek/deepseek-v3.2" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("bad_output");
    expect(error.message).toMatch(/no choices/i);
  });

  it("rejects an incomplete suggestion (empty tags)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(chatResponse(validContent({ tags: [] }))));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("bad_output");
  });

  it("retries once and succeeds after one unparseable response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse("no JSON here, sorry"))
      .mockResolvedValueOnce(chatResponse(validContent()));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(suggestion.title).toBe("Evening in Velvet");
  });

  it("retries once without response_format when the provider rejects the format setting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400, "response_format json_object is not supported by this model"))
      .mockResolvedValueOnce(chatResponse(validContent()));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(callsOf(fetchMock)[0][1].body));
    const secondBody = JSON.parse(String(callsOf(fetchMock)[1][1].body));
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(secondBody.response_format).toBeUndefined();
    expect(suggestion.title).toBe("Evening in Velvet");
  });
});

describe("HTTP error handling", () => {
  it("maps 401 to an auth/configuration error with an actionable message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, "Incorrect API key provided"));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("auth");
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/NEXT_PUBLIC_OPENROUTER_API_KEY/);
    expect(error.message).not.toContain(TEST_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1); // auth failures are terminal
  });

  it("maps 403 to an auth error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(403, "Access denied"));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error.code).toBe("auth");
    expect(error.status).toBe(403);
  });

  it("maps 429 to quota/rate-limit exhaustion without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(429, "Rate limit exceeded: slow down"));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("quota_exceeded");
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/rate limit|quota/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 5xx to a transient provider error", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(errorResponse(502, "Bad gateway")));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("provider_error");
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/HTTP 502/);
  });

  it("retries a 5xx once and can succeed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503, "Service unavailable"))
      .mockResolvedValueOnce(chatResponse(validContent()));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata } = await import("@/lib/openrouter/browser-client");
    const suggestion = await suggestVideoMetadata({ fileName: "clip.mp4" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(suggestion.title).toBe("Evening in Velvet");
  });

  it("redacts key material echoed back by the provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(400, `bad request for key ${TEST_KEY} — fix it`));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.message).not.toContain(TEST_KEY);
    expect(error.message).toMatch(/redacted/);
  });

  it("rejects a non-JSON error body without crashing", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 })));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("provider_error");
  });
});

describe("configuration, network, timeout and cancellation", () => {
  it("fails honestly when the key is missing — without issuing a request", async () => {
    delete process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError, openRouterConfigured, openRouterDiagnostics } = await import(
      "@/lib/openrouter/browser-client"
    );
    expect(openRouterConfigured()).toBe(false);
    expect(openRouterDiagnostics().configured).toBe(false);

    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("not_configured");
    expect(error.message).toMatch(/NEXT_PUBLIC_OPENROUTER_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a network failure to a secret-free network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("network");
    expect(error.message).toMatch(/Could not reach OpenRouter/);
    expect(error.message).not.toContain(TEST_KEY);
  });

  it("times out when the provider never answers", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }, { timeoutMs: 25 }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("timeout");
    expect(error.message).toMatch(/timed out/);
  }, 10_000);

  it("supports caller cancellation via AbortSignal", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const { suggestVideoMetadata, OpenRouterError } = await import("@/lib/openrouter/browser-client");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);
    const error = await suggestVideoMetadata({ fileName: "clip.mp4" }, { signal: controller.signal }).catch(
      (caught) => caught
    );
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("cancelled");
    expect(error.message).toMatch(/cancelled/i);
  }, 10_000);
});

describe("probeOpenRouter / openRouterDiagnostics", () => {
  it("reports configuration without any network call and without key material", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { openRouterDiagnostics } = await import("@/lib/openrouter/browser-client");
    const diagnostics = openRouterDiagnostics();
    expect(diagnostics).toEqual({
      configured: true,
      model: "deepseek/deepseek-v3.2",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
    });
    expect(JSON.stringify(diagnostics)).not.toContain(TEST_KEY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes the live endpoint with a tiny request and reports success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const { probeOpenRouter } = await import("@/lib/openrouter/browser-client");
    const probe = await probeOpenRouter();
    expect(probe).toMatchObject({ ok: true, configured: true, model: "deepseek/deepseek-v3.2" });
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = callsOf(fetchMock)[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBeLessThanOrEqual(32);
    expect(init.headers["Authorization"]).toBe(`Bearer ${TEST_KEY}`);
  });

  it("reports an invalid key as a failure with an actionable hint and no key material", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, "Incorrect API key provided"));
    vi.stubGlobal("fetch", fetchMock);

    const { probeOpenRouter } = await import("@/lib/openrouter/browser-client");
    const probe = await probeOpenRouter();
    expect(probe.ok).toBe(false);
    expect(probe.configured).toBe(true);
    expect(probe.error).toBeTruthy();
    expect(probe.hint).toMatch(/openrouter\.ai\/keys/);
    expect(JSON.stringify(probe)).not.toContain(TEST_KEY);
  });

  it("reports quota exhaustion distinctly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(429, "Insufficient credits"));
    vi.stubGlobal("fetch", fetchMock);

    const { probeOpenRouter } = await import("@/lib/openrouter/browser-client");
    const probe = await probeOpenRouter();
    expect(probe.ok).toBe(false);
    expect(probe.error).toMatch(/429|quota|rate/i);
    expect(probe.hint).toMatch(/credits|rate-limit/i);
    expect(JSON.stringify(probe)).not.toContain(TEST_KEY);
  });

  it("reports a missing key without any network call", async () => {
    delete process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { probeOpenRouter } = await import("@/lib/openrouter/browser-client");
    const probe = await probeOpenRouter();
    expect(probe.ok).toBe(false);
    expect(probe.configured).toBe(false);
    expect(probe.hint).toMatch(/NEXT_PUBLIC_OPENROUTER_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports connection failures distinctly from configuration failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const { probeOpenRouter } = await import("@/lib/openrouter/browser-client");
    const probe = await probeOpenRouter();
    expect(probe.ok).toBe(false);
    expect(probe.error).toMatch(/Could not reach OpenRouter/);
    expect(probe.hint).toMatch(/connectivity|CORS/i);
    expect(JSON.stringify(probe)).not.toContain(TEST_KEY);
  });
});
