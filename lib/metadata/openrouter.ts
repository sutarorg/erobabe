/**
 * OpenRouter client for AI video metadata — server-only.
 *
 * Calls the OpenAI-compatible chat completions endpoint with NVIDIA Nemotron 3
 * Ultra (free) by default. The upload flow can publish after encoding, so the
 * admin should preview and edit category-led drafts before starting whenever
 * possible.
 *
 * One draft request asks the preferred model first and falls through to the
 * configured fallback routes when that route stalls: a free endpoint can sit in
 * a provider queue for longer than a draft may wait, and a single-route client
 * turned that into an upload queue that never started. Each route gets a slice
 * of the request budget (`MODEL_ATTEMPT_TIMEOUT_MS`), a route that stalls is
 * benched for a while (`MODEL_COOLDOWN_MS`), and the caller keeps the unchanged
 * rule that titles are only ever written by a model — never composed offline.
 *
 * Configuration (server environment only, never shipped to the browser):
 *   OPENROUTER_API_KEY           required, starts with `sk-or-`
 *   OPENROUTER_MODEL             optional, default
 *                                `nvidia/nemotron-3-ultra-550b-a55b:free`
 *   OPENROUTER_FALLBACK_MODELS   optional, comma-separated routes tried after
 *                                the model above; unset uses the built-in free
 *                                fallbacks, empty means "primary model only"
 *   OPENROUTER_MAX_OUTPUT_TOKENS optional, default 512
 */

import {
  buildPrompt,
  MAX_DESCRIPTION_WORDS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_DESCRIPTION_WORDS,
  parseLooseJson,
  PROMPT_AVOID_LIMIT,
  redactKeyMaterial,
  resolveTitleStyle,
  suggestionOutputTokens,
  titleBands,
  titleSearchKey,
  titlesAreTooSimilar,
  validateSuggestionPayload,
  type SuggestMetadataParams,
  type SuggestedMetadata,
  type TitleStyle,
} from "./suggestion";
import {
  buildCarouselPrompt,
  carouselCopyFromValue,
  carouselCopyNeedsTrim,
  fallbackCarouselCopy,
  type CarouselCopySource,
} from "./carousel-copy";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
/** Re-exported so callers never have to reach past this client for its types. */
export type { SuggestedMetadata } from "./suggestion";
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
/**
 * Free routes asked in order when the preferred model does not answer. They are
 * the same NVIDIA-served family as the default model, so an upload batch keeps
 * one content policy while a route that is queued, rate limited, or retired is
 * skipped instead of stopping the queue.
 */
export const DEFAULT_OPENROUTER_FALLBACK_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];
/**
 * Routes one draft request may ask. Three slices fit inside the suggestion
 * budget, so a request still answers while the route it prefers is stalled.
 */
export const MAX_MODEL_ROUTES = 3;
/**
 * Longest a single route may take before the next one is asked. A free endpoint
 * that has not produced a token in this long is queueing, not thinking, and
 * waiting the full `REQUEST_TIMEOUT_MS` on it is what left uploads retrying
 * forever.
 */
export const MODEL_ATTEMPT_TIMEOUT_MS = 20_000;
/** Longest one request to one route may take when it is the only route left. */
export const REQUEST_TIMEOUT_MS = 45_000;
export const SUGGESTION_ATTEMPTS = 3;
/**
 * Time one suggestion may spend across all attempts when the caller sets no
 * deadline. It leaves the 60 s metadata route room to answer either way.
 */
export const SUGGESTION_BUDGET_MS = 50_000;
/** An attempt with less time than this left is not started. */
export const MIN_ATTEMPT_MS = 6_000;
/**
 * Consecutive stalls (a route that ran out of its slice without answering) that
 * bench it, and how long it stays benched. Benched routes are still asked last,
 * so a provider-wide slowdown cannot leave the queue with nothing to try.
 */
export const MODEL_STALL_LIMIT = 2;
export const MODEL_COOLDOWN_MS = 120_000;
/**
 * The most last-resort repairs (see `ValidateOptions.lenient`) a reply may
 * need and still be published when no attempt passes outright. Beyond this,
 * little of the model's own writing would survive, so the caller gets an
 * error instead — titles are never composed offline.
 */
export const MAX_SALVAGE_REPAIRS = 2;

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

/** Splits a comma/space separated model list, dropping blanks. */
function parseModelList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((model) => model.trim())
    .filter(Boolean);
}

/**
 * Routes to ask after the preferred model. Unset uses the built-ins above; an
 * explicitly empty value means "the preferred model only", so an operator who
 * does not want fallbacks can say so without unsetting the variable.
 */
export function openRouterFallbackModels(): string[] {
  const configured = process.env.OPENROUTER_FALLBACK_MODELS;
  if (configured === undefined) return [...DEFAULT_OPENROUTER_FALLBACK_MODELS];
  return parseModelList(configured);
}

/**
 * The preferred model first, then the fallbacks — deduplicated, and capped at
 * `MAX_MODEL_ROUTES` because a longer chain cannot fit the request budget.
 */
export function openRouterModelChain(): string[] {
  const chain: string[] = [];
  for (const model of [openRouterModelName(), ...openRouterFallbackModels()]) {
    if (!chain.includes(model)) chain.push(model);
    if (chain.length === MAX_MODEL_ROUTES) break;
  }
  return chain;
}

/**
 * Per-route health for this server process. Only stalls are recorded: a route
 * that answers with an error quickly is cheap to retry, while one that never
 * answers is what makes the upload queue sit still.
 */
const routeHealth = new Map<string, { stalls: number; benchedUntil: number }>();

function routeState(model: string): { stalls: number; benchedUntil: number } {
  return routeHealth.get(model) ?? { stalls: 0, benchedUntil: 0 };
}

function noteRouteAnswer(model: string): void {
  routeHealth.delete(model);
}

function noteRouteStall(model: string): void {
  const state = routeState(model);
  const stalls = state.stalls + 1;
  routeHealth.set(model, {
    stalls,
    benchedUntil:
      stalls >= MODEL_STALL_LIMIT ? Date.now() + MODEL_COOLDOWN_MS : state.benchedUntil,
  });
}

/** Preferred order, with benched routes moved to the end instead of dropped. */
function rankedModelChain(chain: readonly string[]): string[] {
  const now = Date.now();
  const ready: string[] = [];
  const benched: string[] = [];
  for (const model of chain) {
    (routeState(model).benchedUntil > now ? benched : ready).push(model);
  }
  return [...ready, ...benched];
}

/**
 * Forgets which routes were stalling. Exported for tests, and for a caller that
 * has just changed the model configuration.
 */
export function resetOpenRouterModelHealth(): void {
  routeHealth.clear();
}

/** Secret-free route health for the admin UI. */
export function openRouterRouteHealth(): Array<{
  model: string;
  benched: boolean;
  stalls: number;
  cooldownRemainingMs: number;
}> {
  const now = Date.now();
  return openRouterModelChain().map((model) => {
    const state = routeState(model);
    return {
      model,
      benched: state.benchedUntil > now,
      stalls: state.stalls,
      cooldownRemainingMs: Math.max(0, state.benchedUntil - now),
    };
  });
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
    // Free-model usage is capped per minute and per day at the account level, so
    // this refusal outlives the usual retry backoff: say what hit the limit
    // instead of promising an answer that the next retry cannot deliver.
    return new MetadataError(
      "OpenRouter rate or quota limit reached (free-model usage is capped per minute and per day). Try again shortly.",
      429,
      "quota_exceeded"
    );
  }
  if (status === 404) {
    return new MetadataError(
      `Model "${model}" is not available on OpenRouter. Check OPENROUTER_MODEL and the fallback routes.`,
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
  /** Route that answered — the admin's "Test OpenRouter" reports this. */
  model: string;
}

interface ChatOptions {
  maxTokens: number;
  temperature: number;
  /**
   * Budget for the whole call, shared by every route it asks. Each route gets
   * at most `MODEL_ATTEMPT_TIMEOUT_MS` while another route is still untried.
   */
  timeoutMs?: number;
}

/** Failures that mean "this route cannot answer now": the next one is asked. */
const ROUTE_FAILURE_CODES = new Set<MetadataErrorCode>([
  "timeout",
  "provider_error",
  "model_unavailable",
]);

/**
 * Reaching OpenRouter itself failed (DNS, refused connection, reset socket).
 * Every route lives behind the same host, so this is reported to the caller —
 * which retries — instead of being repeated down the chain.
 */
class UnreachableError extends MetadataError {}

/**
 * Which message an admin should see when every route failed. The most
 * actionable one wins: a rejected key is fixed in the environment, while a
 * timeout just needs another try.
 */
const ERROR_PRIORITY: Record<MetadataErrorCode, number> = {
  not_configured: 0,
  quota_exceeded: 1,
  model_unavailable: 2,
  provider_error: 3,
  timeout: 4,
  bad_output: 5,
};

/** The timeout every admin sees, naming the route that stayed silent. */
function timeoutError(model?: string): MetadataError {
  return new MetadataError(
    model
      ? `OpenRouter did not answer in time (${model}). Try again.`
      : "OpenRouter did not answer in time. Try again.",
    504,
    "timeout",
  );
}

/**
 * One chat completion, tried across the route chain until a route answers with
 * content.
 *
 * This is the fix for uploads that sat on "Waiting for AI title": a free
 * endpoint queued at the provider never answers, so a single-route client spent
 * a whole request budget on one silent route, every retry repeated the wait,
 * and the queue never started. Now a silent route is dropped for its slice, the
 * next route is asked inside the same budget, and a route that stalls twice in
 * a row is benched for `MODEL_COOLDOWN_MS` so later retries skip it. Key,
 * quota, and request-option errors are not route-specific, so they fail
 * immediately instead of being repeated down the chain.
 */
async function chatCompletion(
  prompt: string,
  models: readonly string[],
  key: string,
  options: ChatOptions
): Promise<ChatResult> {
  const chain = rankedModelChain(models.length ? models : openRouterModelChain());
  const budget = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const startedAt = Date.now();
  let failure: MetadataError | null = null;

  for (let index = 0; index < chain.length; index += 1) {
    const remaining = budget - (Date.now() - startedAt);
    // A route with less than the minimum attempt window left is not started.
    if (remaining < MIN_ATTEMPT_MS) break;
    const routesAfter = chain.length - index - 1;
    const slice = Math.min(remaining, routesAfter > 0 ? MODEL_ATTEMPT_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    const model = chain[index]!;

    try {
      const result = await chatOnce(prompt, model, key, options, slice);
      noteRouteAnswer(model);
      return result;
    } catch (error: unknown) {
      const mapped =
        error instanceof MetadataError
          ? error
          : new MetadataError("OpenRouter request failed unexpectedly.", 502, "provider_error");
      if (mapped instanceof UnreachableError || !ROUTE_FAILURE_CODES.has(mapped.code)) throw mapped;
      if (mapped.code === "timeout") noteRouteStall(model);
      if (!failure || ERROR_PRIORITY[mapped.code] < ERROR_PRIORITY[failure.code]) failure = mapped;
    }
  }

  throw failure ?? timeoutError(chain[0]);
}

/**
 * Sends one chat completion to one route. The optional JSON mode and reasoning
 * switch are dropped one at a time if the provider rejects them, so an unusual
 * upstream route degrades to plain text instead of failing outright.
 */
async function chatOnce(
  prompt: string,
  model: string,
  key: string,
  options: ChatOptions,
  timeoutMs: number
): Promise<ChatResult> {
  const optional = new Set(["response_format", "reasoning"]);
  let includeJson = true;
  let includeReasoning = true;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature,
      max_completion_tokens: options.maxTokens,
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
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw timeoutError(model);
      }
      throw new UnreachableError("Could not reach OpenRouter. Try again.", 502, "provider_error");
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
      model,
    };
  }

  throw new MetadataError("OpenRouter rejected the request options. Check OPENROUTER_MODEL.", 502, "provider_error");
}

/** Unique titles in the order given (most relevant first), blanks dropped. */
function uniqueTitles(titles: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of titles || []) {
    const title = String(raw || "").trim();
    const key = titleSearchKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(title);
  }
  return unique;
}

function correctionPrompt(failure: string, style: TitleStyle): string {
  const { words } = titleBands(style);
  return `\nThe previous suggestion failed validation: ${failure}. Return a corrected JSON object. Keep the admin-selected category as the only content signal and choose a distinctly different angle and word order. ${
    style === "explicit"
      ? `Write a ${words.min}-${words.max}-word adult-tube title that names the sex plainly with words like fuck, cock, dick, pussy, ass or blowjob, says who is doing it and where, never uses euphemisms or review language, and never spells out the category's own name in the title (the category field already carries that). Do not add an age, a family relationship, or anything implying a partner who cannot consent.`
      : `Use a factual non-graphic ${words.min}-${words.max}-word title.`
  } Write a category-led description of exactly ${MIN_DESCRIPTION_WORDS}-${MAX_DESCRIPTION_WORDS} words.\n`;
}

/**
 * Asks the model for title, description, tags, and category for one file, in the
 * voice the site publishes (`VIDEO_TITLE_STYLE`, explicit by default: blunt
 * adult titles that name the act, not euphemistic programme notes).
 *
 * Length near-misses are repaired, never rejected: an overlong title is cut at
 * a clause boundary that keeps the act and the category, and the description
 * is trimmed or extended into the 20-25 word range. A reply that is still
 * unusable (unparseable, off-voice, unpublishable, a description fragment, a
 * repeated title) is retried with corrective feedback, up to
 * `SUGGESTION_ATTEMPTS` times within the deadline.
 *
 * When no attempt passes outright, the best reply that needs at most
 * `MAX_SALVAGE_REPAIRS` last-resort repairs is published rather than discarded;
 * only when there is none does this throw `MetadataError`. There is no offline
 * fallback title: the caller (the `/api/metadata/suggest` route) is expected to
 * surface the error and let the admin retry rather than publish a filler title.
 *
 * Exact repeats are checked against every supplied title; near-duplicates only
 * against the `PROMPT_AVOID_LIMIT` titles the model was shown.
 */
export async function suggestVideoMetadata(params: SuggestMetadataParams): Promise<SuggestedMetadata> {
  const key = openRouterApiKey();
  if (!key) throw new MetadataError(OPENROUTER_NOT_CONFIGURED_MESSAGE, 503, "not_configured");

  const style: TitleStyle = params.style ?? resolveTitleStyle();
  const models = openRouterModelChain();
  const existing = uniqueTitles(params.existingTitles);
  const takenKeys = new Set(existing.map(titleSearchKey));
  const shownToModel = existing.slice(0, PROMPT_AVOID_LIMIT);
  const prompt = buildPrompt({ ...params, existingTitles: existing, style });
  const deadline = params.deadline ?? Date.now() + SUGGESTION_BUDGET_MS;
  const baseTokens = suggestionOutputTokens();
  const expandedTokens = Math.min(baseTokens * 2, MAX_MAX_OUTPUT_TOKENS);
  let retryMaxTokens = baseTokens;
  let correction = "";
  let lastError: MetadataError | null = null;
  let salvage: { suggestion: SuggestedMetadata; cost: number } | null = null;

  for (let attempt = 0; attempt < SUGGESTION_ATTEMPTS; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      lastError ??= timeoutError(models[0]);
      break;
    }

    const maxTokens = attempt === 0 ? baseTokens : retryMaxTokens;
    let result: ChatResult;
    try {
      result = await chatCompletion(prompt + correction, models, key, {
        maxTokens,
        temperature: attempt === 0 ? 0.9 : 0.75,
        // Every route in the chain draws from what is left of the deadline.
        timeoutMs: remaining,
      });
    } catch (error: unknown) {
      const mapped =
        error instanceof MetadataError
          ? error
          : new MetadataError("AI metadata failed unexpectedly.", 502, "provider_error");
      lastError = mapped;
      // Quota, auth, and model errors will not fix themselves on retry.
      if (mapped.code === "quota_exceeded" || mapped.code === "not_configured" || mapped.code === "model_unavailable") {
        break;
      }
      continue;
    }

    if (!result.text.trim()) {
      // Spend a larger output budget only when the previous response was empty;
      // semantic/validation retries keep the compact default cap.
      if (!result.refusal) retryMaxTokens = expandedTokens;
      lastError = new MetadataError(
        result.refusal
          ? "The model declined to produce a suggestion for this file."
          : "OpenRouter returned an empty suggestion.",
        502,
        "bad_output"
      );
      continue;
    }

    let failure: string;
    const validation = validateSuggestionPayload(result.text, params.category, { style });
    if (validation.ok) {
      const title = validation.suggestion.title;
      if (takenKeys.has(titleSearchKey(title))) {
        failure = "title duplicates an existing listing";
      } else if (shownToModel.some((existingTitle) => titlesAreTooSimilar(title, existingTitle))) {
        failure = "title is a near-duplicate of an existing listing";
      } else {
        return validation.suggestion;
      }
    } else {
      failure = validation.message;
    }

    // Keep the best reply a last-resort repair can publish, in case no later
    // attempt passes outright. An exact repeat is never kept.
    const repaired = validateSuggestionPayload(result.text, params.category, { style, lenient: true });
    if (repaired.ok && !takenKeys.has(titleSearchKey(repaired.suggestion.title))) {
      const nearDuplicate = shownToModel.some((existingTitle) =>
        titlesAreTooSimilar(repaired.suggestion.title, existingTitle),
      );
      const cost = repaired.repairCost + (nearDuplicate ? 1 : 0);
      if (cost <= MAX_SALVAGE_REPAIRS && (!salvage || cost < salvage.cost)) {
        const notes = [...repaired.repairs, ...(nearDuplicate ? ["close to a recent title"] : [])];
        salvage = {
          cost,
          suggestion: {
            ...repaired.suggestion,
            reasoning: `AI-generated suggestion, kept after attempt ${attempt + 1} failed validation (${failure}; ${notes.join("; ")}), requires human review`,
          },
        };
      }
    }

    correction = correctionPrompt(failure, style);
    const truncated = result.finishReason === "length" && !parseLooseJson(result.text);
    retryMaxTokens = truncated ? expandedTokens : baseTokens;
    lastError = new MetadataError(
      truncated
        ? "The suggestion was cut off before it finished."
        : `The model's suggestion was unusable: ${failure}.`,
      502,
      "bad_output"
    );
  }

  if (salvage) return salvage.suggestion;
  throw lastError ?? new MetadataError("AI metadata failed unexpectedly.", 502, "provider_error");
}

/** Output-token budget for one carousel copy — two short fields, nothing more. */
export const CAROUSEL_COPY_MAX_TOKENS = 128;
export const CAROUSEL_COPY_ATTEMPTS = 2;
/** Shorter than the listing-metadata budget: an admin is waiting on this click. */
export const CAROUSEL_COPY_TIMEOUT_MS = 30_000;
/**
 * Budget for the admin-triggered connectivity probe. It is short on purpose:
 * the probe walks the route chain within it, so a stalled preferred route is
 * reported as a working fallback rather than as a minute of silence.
 */
export const PROBE_TIMEOUT_MS = 30_000;

export interface CarouselCopyResult {
  /** Headline for the homepage card — never more than 5 words. */
  title: string;
  /** Teaser for the homepage card — never more than 10 words. */
  description: string;
  /** `ai` when OpenRouter wrote it (possibly trimmed to the word budget). */
  source: "ai" | "fallback";
  /** Model that was asked (or would have been asked). */
  model: string;
  /** The model answered over budget and the answer was cut to fit the card. */
  trimmed: boolean;
  /** Secret-free reason the AI copy was not used, for the admin UI. */
  warning?: string;
}

const CAROUSEL_COPY_REJECTED =
  "AI carousel copy was unusable — the listing text was shortened to fit the card instead.";

/**
 * Asks the model for the two short fields the homepage carousel card shows when
 * an admin puts a video in a slot: a headline of at most 5 words and a teaser of
 * at most 10 words.
 *
 * This never throws. Putting a video in the carousel must not fail because the
 * AI is unreachable, unconfigured, or wordy: an unusable answer degrades to the
 * listing itself, trimmed to the same budget, and the admin is told why.
 */
export async function suggestCarouselCopy(
  source: CarouselCopySource,
): Promise<CarouselCopyResult> {
  const fallback = fallbackCarouselCopy(source);
  const model = openRouterModelName();
  const models = openRouterModelChain();
  const key = openRouterApiKey();
  const base = { model, trimmed: false };

  if (!key) {
    return {
      ...fallback,
      ...base,
      source: "fallback",
      warning: OPENROUTER_NOT_CONFIGURED_MESSAGE,
    };
  }

  const prompt = buildCarouselPrompt(source);
  let warning = CAROUSEL_COPY_REJECTED;
  let correction = "";

  for (let attempt = 0; attempt < CAROUSEL_COPY_ATTEMPTS; attempt += 1) {
    let text = "";
    try {
      const result = await chatCompletion(prompt + correction, models, key, {
        maxTokens: CAROUSEL_COPY_MAX_TOKENS,
        temperature: attempt === 0 ? 0.6 : 0.2,
        timeoutMs: CAROUSEL_COPY_TIMEOUT_MS,
      });
      text = result.text;
    } catch (error: unknown) {
      const mapped =
        error instanceof MetadataError
          ? error
          : new MetadataError(
              "AI carousel copy failed unexpectedly.",
              502,
              "provider_error",
            );
      warning = mapped.message;
      // Auth, quota, model, and slow-provider errors will not fix themselves on
      // a retry — and a second timeout would double the admin's wait.
      if (
        mapped.code === "not_configured" ||
        mapped.code === "quota_exceeded" ||
        mapped.code === "model_unavailable" ||
        mapped.code === "timeout"
      ) {
        break;
      }
      continue;
    }

    const parsed = parseLooseJson(text);
    const copy = parsed ? carouselCopyFromValue(parsed.value) : null;
    if (copy) {
      return {
        ...copy,
        ...base,
        source: "ai",
        trimmed: Boolean(parsed && carouselCopyNeedsTrim(parsed.value)),
      };
    }

    correction =
      "\n\nYour previous answer was rejected: it must be a single JSON object with a non-empty \"title\" of at most 5 words and a non-empty \"description\" of at most 10 words. Answer again with only that JSON object.";
  }

  return { ...fallback, ...base, source: "fallback", warning };
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
  const models = openRouterModelChain();
  const model = models[0] ?? openRouterModelName();
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
    const result = await chatCompletion("Reply with the single word: ok", models, key, {
      maxTokens: 32,
      temperature: 0,
      // Shorter than the suggestion budget: an admin is watching this click,
      // and a stalled route is dropped for the next one instead of being waited on.
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const text = result.text.trim();
    return {
      ...base,
      ok: true,
      // The route that actually answered, which may be a fallback.
      model: result.model,
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
    /** Routes a draft request may ask, preferred first (fallbacks included). */
    models: openRouterModelChain(),
    defaultFallbackModels: [...DEFAULT_OPENROUTER_FALLBACK_MODELS],
    /** Routes currently benched in this process after stalling. */
    routeHealth: openRouterRouteHealth(),
    routeTimeoutMs: MODEL_ATTEMPT_TIMEOUT_MS,
    reasoning: "disabled",
    maxOutputTokens: suggestionOutputTokens(),
    titleStyle: resolveTitleStyle(),
    titleWords: titleBands().words,
  };
}
