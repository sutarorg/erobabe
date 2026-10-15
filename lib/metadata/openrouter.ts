/**
 * OpenRouter client for AI video metadata — server-only.
 *
 * Calls the OpenAI-compatible chat completions endpoint with DeepSeek V3.2 by
 * default. Suggestions always require human review before publishing.
 *
 * Configuration (server environment only, never shipped to the browser):
 *   OPENROUTER_API_KEY           required, starts with `sk-or-`
 *   OPENROUTER_MODEL             optional, default `deepseek/deepseek-v3.2`
 *   OPENROUTER_MAX_OUTPUT_TOKENS optional, default 2048
 */

import {
  buildPrompt,
  MAX_DESCRIPTION_WORDS,
  MIN_DESCRIPTION_WORDS,
  parseLooseJson,
  redactKeyMaterial,
  suggestionOutputTokens,
  validateSuggestionPayload,
  type SuggestMetadataParams,
  type SuggestedMetadata,
} from "./suggestion";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v3.2";
export const REQUEST_TIMEOUT_MS = 45_000;
export const SUGGESTION_ATTEMPTS = 2;

/** Shown to the admin whenever the server cannot see a key. */
export const OPENROUTER_NOT_CONFIGURED_MESSAGE =
  "OpenRouter is not configured — set the OPENROUTER_API_KEY server variable. It must be defined in the hosting project's environment variables (for Vercel: Project → Settings → Environment Variables, Production scope), then redeploy. Keys stored only as Supabase secrets are not visible to this app.";

export type MetadataErrorCode =
  | "not_configured"
  | "quota_exceeded"
  | "model_unavailable"
  | "provider_error"
  | "bad_output"
  | "timeout";

export class MetadataError extends Error {
  readonly status: number;
  readonly code: MetadataErrorCode;

  constructor(message: string, status: number, code: MetadataErrorCode) {
    super(message);
    this.name = "MetadataError";
    this.status = status;
    this.code = code;
  }
}

/** Trims whitespace, a leading `OPENROUTER_API_KEY=`, and wrapping quotes. */
export function normalizeOpenRouterKey(raw: unknown): string {
  let value = String(raw ?? "").trim();
  value = value.replace(/^OPENROUTER_API_KEY\s*=\s*/i, "").trim();
  value = value.replace(/^(["'`])([\s\S]*)\1$/, "$2").trim();
  return /\s/.test(value) ? "" : value;
}

export function openRouterApiKey(): string {
  return normalizeOpenRouterKey(process.env.OPENROUTER_API_KEY || "");
}

export function openRouterModelName(): string {
  const configured = String(process.env.OPENROUTER_MODEL || "").trim();
  return configured || DEFAULT_OPENROUTER_MODEL;
}

type KeyKind = "openrouter" | "unknown" | "missing";

function keyKindOf(key: string): KeyKind {
  if (!key) return "missing";
  if (/^sk-or-/i.test(key)) return "openrouter";
  return "unknown";
}

/** Structured error for an OpenRouter HTTP failure. Never includes the key. */
function mapHttpError(status: number, providerMessage: string, model: string): MetadataError {
  const detail = redactKeyMaterial(providerMessage).slice(0, 200);
  if (status === 401 || status === 403) {
    return new MetadataError(
      "OpenRouter rejected OPENROUTER_API_KEY. Create a key at openrouter.ai/keys and update the server variable.",
      503,
      "not_configured"
    );
  }
  if (status === 402) {
    return new MetadataError(
      "The OpenRouter account has no credits left. Add credits at openrouter.ai, then try again.",
      429,
      "quota_exceeded"
    );
  }
  if (status === 429) {
    return new MetadataError("OpenRouter rate or quota limit reached. Try again shortly.", 429, "quota_exceeded");
  }
  if (status === 404) {
    return new MetadataError(
      `Model "${model}" is not available on OpenRouter. Check OPENROUTER_MODEL.`,
      502,
      "model_unavailable"
    );
  }
  return new MetadataError(
    `OpenRouter request failed (HTTP ${status})${detail ? `: ${detail}` : ""}`,
    502,
    "provider_error"
  );
}

interface ChatResult {
  text: string;
  finishReason?: string;
  refusal?: string;
}

interface ChatOptions {
  maxTokens: number;
  temperature: number;
}

/**
 * Sends one chat completion. The optional JSON mode and reasoning switch are
 * dropped one at a time if the provider rejects them, so an unusual upstream
 * route degrades to plain text instead of failing outright.
 */
async function chatCompletion(prompt: string, model: string, key: string, options: ChatOptions): Promise<ChatResult> {
  const optional = new Set(["response_format", "reasoning"]);
  let includeJson = true;
  let includeReasoning = true;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };
    if (includeJson) body.response_format = { type: "json_object" };
    if (includeReasoning) body.reasoning = { enabled: false };

    let response: Response;
    try {
      response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Erobabe",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new MetadataError("OpenRouter did not answer in time. Try again.", 504, "timeout");
      }
      throw new MetadataError("Could not reach OpenRouter. Try again.", 502, "provider_error");
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok) {
      const providerMessage = String(
        (payload?.error as { message?: unknown } | undefined)?.message ?? `HTTP ${response.status}`
      );
      // A 400 that names an optional field means this route does not accept it: drop it and retry.
      if (response.status === 400) {
        const named = [...optional].find(
          (field) =>
            new RegExp(field.replace("_", "[_ ]"), "i").test(providerMessage) &&
            (field === "response_format" ? includeJson : includeReasoning)
        );
        if (named) {
          if (named === "response_format") includeJson = false;
          else includeReasoning = false;
          continue;
        }
      }
      throw mapHttpError(response.status, providerMessage, model);
    }

    const choice = (Array.isArray(payload?.choices) ? payload?.choices[0] : undefined) as
      | { finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown } }
      | undefined;
    const content = choice?.message?.content;
    return {
      text: typeof content === "string" ? content : "",
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
      refusal: typeof choice?.message?.refusal === "string" ? choice.message.refusal : undefined,
    };
  }

  throw new MetadataError("OpenRouter rejected the request options. Check OPENROUTER_MODEL.", 502, "provider_error");
}

/**
 * Asks the model for title, description, tags, and category for one file.
 *
 * Retries once with corrective feedback when the reply is incomplete, outside
 * the description word limit, empty, or truncated. If the retry still misses
 * the word count, the description is repaired locally — a title and blurb the
 * model wrote for the selected category are never thrown away over a count.
 */
export async function suggestVideoMetadata(params: SuggestMetadataParams): Promise<SuggestedMetadata> {
  const key = openRouterApiKey();
  if (!key) throw new MetadataError(OPENROUTER_NOT_CONFIGURED_MESSAGE, 503, "not_configured");

  const model = openRouterModelName();
  const prompt = buildPrompt(params);
  let correction = "";
  const baseTokens = suggestionOutputTokens();
  let lastError: MetadataError | null = null;
  let lastText = "";

  for (let attempt = 0; attempt < SUGGESTION_ATTEMPTS; attempt += 1) {
    const maxTokens = attempt === 0 ? baseTokens : Math.min(baseTokens * 2, 16_384);
    let result: ChatResult;
    try {
      result = await chatCompletion(prompt + correction, model, key, {
        maxTokens,
        temperature: attempt === 0 ? 0.7 : 0.2,
      });
    } catch (error: unknown) {
      const mapped =
        error instanceof MetadataError
          ? error
          : new MetadataError("AI metadata failed unexpectedly.", 502, "provider_error");
      // Quota, auth, and model errors will not fix themselves on retry.
      if (mapped.code === "quota_exceeded" || mapped.code === "not_configured" || mapped.code === "model_unavailable") {
        throw mapped;
      }
      lastError = mapped;
      continue;
    }

    if (!result.text.trim()) {
      lastError = new MetadataError(
        result.refusal
          ? "The model declined to produce a suggestion for this file."
          : "OpenRouter returned an empty suggestion.",
        502,
        "bad_output"
      );
      continue;
    }

    lastText = result.text;

    // Ask for a clean answer on the first pass so the model still gets one
    // corrective retry. After that, an off-count description is repaired rather
    // than allowed to sink an otherwise good title, tags, and description.
    const validation = validateSuggestionPayload(result.text, params.category, {
      strictWordCount: attempt === 0,
    });
    if (validation.ok) return validation.suggestion;

    correction = `\nThe previous suggestion failed validation: ${validation.message}. Return a corrected JSON object that meets every requirement: a distinct, attention-grabbing explicit adult SEO one-clause title without the category name or any dash, an explicit story-like description written for the selected category, and a description of exactly ${MIN_DESCRIPTION_WORDS}-${MAX_DESCRIPTION_WORDS} words.\n`;
    const truncated = result.finishReason === "length" && !parseLooseJson(result.text);
    lastError = new MetadataError(
      truncated
        ? "The suggestion was cut off before it finished."
        : `The model's suggestion was unusable: ${validation.message}.`,
      502,
      "bad_output"
    );
  }

  // Last resort: a network failure on the retry can still leave us holding a
  // parseable first answer. Repair it instead of dropping back to file-name
  // metadata, which is what the admin was seeing.
  if (lastText) {
    const salvaged = validateSuggestionPayload(lastText, params.category);
    if (salvaged.ok) return salvaged.suggestion;
  }

  throw lastError ?? new MetadataError("AI metadata failed unexpectedly.", 502, "provider_error");
}

export interface OpenRouterProbeResult {
  ok: boolean;
  /** Key present at all (never the key itself). */
  configured: boolean;
  keyKind: KeyKind;
  /** Model that answered (or was tried). */
  model: string;
  /** Round-trip time in milliseconds. */
  latencyMs: number;
  /** Short, secret-free error description when `ok` is false. */
  error?: string;
  /** Actionable next step when `ok` is false. */
  hint?: string;
}

/**
 * Sends one tiny real request so an admin can prove the key works end-to-end.
 * It proves authentication and model access, not suggestion quality.
 */
export async function probeOpenRouter(): Promise<OpenRouterProbeResult> {
  const key = openRouterApiKey();
  const startedAt = Date.now();
  const model = openRouterModelName();
  const base: OpenRouterProbeResult = {
    ok: false,
    configured: Boolean(key),
    keyKind: keyKindOf(key),
    model,
    latencyMs: 0,
  };

  if (!key) {
    return { ...base, hint: "Set OPENROUTER_API_KEY in the server environment and redeploy." };
  }

  try {
    const result = await chatCompletion("Reply with the single word: ok", model, key, {
      maxTokens: 32,
      temperature: 0,
    });
    const text = result.text.trim();
    return {
      ...base,
      ok: true,
      latencyMs: Date.now() - startedAt,
      ...(text ? {} : { hint: "The model answered without text — metadata suggestions may still work." }),
    };
  } catch (error: unknown) {
    const mapped =
      error instanceof MetadataError ? error : new MetadataError("Probe failed.", 502, "provider_error");
    return {
      ...base,
      latencyMs: Date.now() - startedAt,
      error: mapped.message,
      hint:
        mapped.code === "quota_exceeded"
          ? "Add credits to the OpenRouter account, or wait for the limit to reset."
          : mapped.code === "not_configured"
            ? "Create a new key at openrouter.ai/keys and update OPENROUTER_API_KEY, then redeploy."
            : mapped.code === "model_unavailable"
              ? "Check OPENROUTER_MODEL against the models listed on openrouter.ai."
              : "Try again. If it persists, check OpenRouter status and the server logs.",
    };
  }
}

/** Configuration summary for the admin UI — no network call, no key material. */
export function openRouterDiagnostics() {
  const key = openRouterApiKey();
  return {
    configured: Boolean(key),
    keyKind: keyKindOf(key),
    provider: "OpenRouter",
    endpoint: "openrouter.ai/api/v1/chat/completions",
    model: openRouterModelName(),
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    reasoning: "disabled",
    maxOutputTokens: suggestionOutputTokens(),
  };
}
