/**
 * Catalog-metadata helpers shared by the browser OpenRouter client, the
 * server-side publishing pipeline, and the tests.
 *
 * Pure, isomorphic code: no network calls, no Node-only imports, and never
 * any key material. The AI request itself lives in
 * `lib/openrouter/browser-client.ts` (browser-only); the deterministic
 * fallback and validation rules live here so the frontend and the backend
 * agree on them.
 *
 * AI suggestions always require human review and never prove identity, age,
 * consent, ownership, or rights.
 */

import { z } from "zod";

export interface SuggestMetadataParams {
  title?: string;
  fileName?: string;
  category?: string;
  existingTags?: string;
}

export interface SuggestedMetadata {
  title: string;
  description: string;
  tags: string[];
  category: string;
  reasoning?: string;
}

/** Where the metadata for a generated video came from. */
export type MetadataSource = "ai" | "fallback";

/**
 * Metadata prepared for `createGeneratedVideo()` — either validated AI output
 * or the deterministic filename fallback. Both browser and server produce and
 * validate this exact shape.
 */
export type PreparedMetadata = {
  title: string;
  description: string;
  tags: string[];
  source: MetadataSource;
  /** Human-readable reason the AI suggestion was unavailable (`fallback` only). */
  warning?: string;
};

/** Tags the model may return — anything else is filtered out. */
export const PERMITTED_TAGS = [
  "mature",
  "amateur",
  "pov",
  "lesbian",
  "kinky",
  "couples",
  "boudoir",
  "romantic",
  "solo",
  "roleplay",
  "massage",
  "4k",
  "hd",
  "featured",
  "editorial",
] as const;

/** Category taxonomy the suggestion is validated against. */
export const KNOWN_CATEGORIES = [
  "Mature",
  "Amateur",
  "POV",
  "Lesbian",
  "Kinky",
  "Mature 18+",
  "Couples",
  "Boudoir",
  "Romantic",
  "Solo",
  "Roleplay",
  "Massage",
] as const;

/** Hard limits enforced before metadata enters the publishing workflow. */
export const MAX_TITLE_LENGTH = 160;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_TAGS = 8;

export const suggestionSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(MAX_TITLE_LENGTH, "title is too long"),
  description: z.string().trim().min(1, "description is required").max(MAX_DESCRIPTION_LENGTH, "description is too long"),
  tags: z.array(z.string().trim().min(1).max(50)).min(1, "at least one tag is required").max(MAX_TAGS),
  category: z.string().trim().min(1, "category is required").max(80),
});

/* ------------------------------------------------------------------------- */
/* Loose JSON parsing                                                         */
/* ------------------------------------------------------------------------- */

/** Parses only if the result is an object or array; everything else is a miss. */
function tryParse(text: string): unknown | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Drops a byte-order mark and zero-width characters that break `JSON.parse`. */
function stripInvisible(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}

/** Unwraps ```json … ``` fences (and bare ``` / ~~~ fences). */
export function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:json|jsonc|json5)?[ \t]*\r?\n?([\s\S]*?)```/i);
  if (fenced?.[1] && fenced[1].trim()) return fenced[1].trim();
  return raw
    .replace(/^\s*(?:```(?:json)?|~~~)/i, "")
    .replace(/(?:```|~~~)\s*$/i, "")
    .trim();
}

/**
 * Returns the first top-level `{ … }` span, honouring strings and escapes, or
 * `null` when the braces are unbalanced (i.e. the output was truncated).
 */
export function sliceJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth <= 0) return raw.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * Repairs the JSON mistakes models actually make: raw control characters inside
 * strings, smart quotes, and trailing commas before a closing brace/bracket.
 */
export function repairJsonText(raw: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
        output += char;
        continue;
      }
      if (char === "“" || char === "”" || char === "„" || char === "‟") {
        output += '\\"';
        continue;
      }
      if (char === "‘" || char === "’") {
        output += "'";
        continue;
      }
      const code = raw.charCodeAt(index);
      if (code < 0x20) {
        if (char === "\n") output += "\\n";
        else if (char === "\r") output += "\\r";
        else if (char === "\t") output += "\\t";
        else output += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      output += char;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "“" || char === "”" || char === "„" || char === "‟") {
      inString = true;
      output += '"';
      continue;
    }
    if (char === "‘" || char === "’") {
      output += "'";
      continue;
    }
    // Trailing comma: `,"a"]` / `,"a"}` is invalid JSON.
    if (char === ",") {
      let next = index + 1;
      while (next < raw.length && /\s/.test(raw[next])) next += 1;
      if (raw[next] === "}" || raw[next] === "]") continue;
    }
    output += char;
  }

  // A truncated payload ends inside a string — close it so the salvage below
  // still sees complete fields.
  if (inString) output += '"';
  return output;
}

function decodeJsonString(raw: string): string {
  try {
    const value: unknown = JSON.parse(`"${raw}"`);
    return typeof value === "string" ? value : raw;
  } catch {
    return raw;
  }
}

/**
 * Recovers the fields that did complete from a payload cut off mid-object
 * (`{"title":"Evening in Velvet","description":"…","tags":["mature","4k"],"ca…`).
 */
export function salvageSuggestionFields(raw: string): Record<string, unknown> | null {
  const stringField = (key: string): string | null => {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "i"));
    return match?.[1] ? decodeJsonString(match[1]) : null;
  };

  const arrayField = (key: string): string[] | null => {
    // `[^\]]*\]` would swallow the rest of a truncated document, so only a run
    // of quoted items is captured: it stops cleanly at `]` or at the next key.
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*\\[((?:\\s*"[^"]*"\\s*,?\\s*)*)`, "i"));
    if (!match?.[1]) return null;
    const items: string[] = [];
    for (const item of match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const value = decodeJsonString(item[1]).trim();
      if (value) items.push(value);
    }
    return items.length ? items : null;
  };

  const salvaged: Record<string, unknown> = {};
  const title = stringField("title");
  const description = stringField("description");
  const tags = arrayField("tags");
  const category = stringField("category");

  if (title) salvaged.title = title;
  if (description) salvaged.description = description;
  if (tags) salvaged.tags = tags;
  if (category) salvaged.category = category;

  return Object.keys(salvaged).length ? salvaged : null;
}

/**
 * Parses the model's text into JSON, tolerating everything a chat model does
 * around the payload: prose, markdown fences, trailing commas, raw newlines
 * inside strings, smart quotes, and truncation.
 */
export function parseLooseJson(raw: string): { value: unknown; strategy: string } | null {
  if (!raw || !raw.trim()) return null;

  const cleaned = stripInvisible(raw);
  const unfenced = stripCodeFences(cleaned);

  // 1. Straight parse (the normal, schema-constrained case).
  const direct = tryParse(cleaned) ?? tryParse(unfenced);
  if (direct) return { value: direct, strategy: "direct" };

  const base = unfenced || cleaned;

  // 2. First balanced object — drops prose before/after the payload.
  const balanced = sliceJsonObject(base);
  if (balanced) {
    const parsed = tryParse(balanced) ?? tryParse(repairJsonText(balanced));
    if (parsed) return { value: parsed, strategy: balanced === base ? "balanced" : "balanced-slice" };
  }

  // 3. First `{` to last `}` — for unbalanced-but-recoverable output.
  const first = base.indexOf("{");
  const last = base.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const rough = base.slice(first, last + 1);
    const parsed = tryParse(rough) ?? tryParse(repairJsonText(rough));
    if (parsed) return { value: parsed, strategy: "outer-slice" };
  }

  // 4. Repaired whole text (control characters, smart quotes, trailing commas).
  const repaired = tryParse(repairJsonText(base));
  if (repaired) return { value: repaired, strategy: "repaired" };

  // 5. Truncated payload: keep whatever fields completed.
  const salvaged = salvageSuggestionFields(base);
  if (salvaged) return { value: salvaged, strategy: "truncated-salvage" };

  return null;
}

/* ------------------------------------------------------------------------- */
/* Shape coercion and normalization                                           */
/* ------------------------------------------------------------------------- */

function pickField(input: Record<string, unknown>, name: string): unknown {
  if (name in input) return input[name];
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(input)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function looksLikeSuggestion(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof pickField(record, "title") === "string" ||
    typeof pickField(record, "description") === "string" ||
    Array.isArray(pickField(record, "tags")) ||
    typeof pickField(record, "category") === "string"
  );
}

/** Unwraps `[{…}]` or `{"suggestion":{…}}` wrappers the model sometimes adds. */
function unwrapSuggestion(value: unknown, depth = 0): unknown {
  if (depth > 3 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return unwrapSuggestion(value[0], depth + 1);
  const record = value as Record<string, unknown>;
  if (looksLikeSuggestion(record)) return record;
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const unwrapped = unwrapSuggestion(nested, depth + 1);
      if (looksLikeSuggestion(unwrapped)) return unwrapped;
    }
  }
  return value;
}

/**
 * Normalises the payload before validation so near-misses still produce a
 * suggestion: `"tags": "mature, 4k"` instead of an array, capitalised keys from
 * a model that ignored the schema, a numeric title, or a missing category.
 */
export function coerceSuggestionInput(value: unknown, fallbackCategory?: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;

  const rawTitle = pickField(input, "title");
  const rawDescription = pickField(input, "description");
  const rawTags = pickField(input, "tags");
  const rawCategory = pickField(input, "category");

  const asText = (value: unknown): unknown => {
    if (value === undefined) return undefined;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return value;
  };

  let tagValues: unknown[] = [];
  if (typeof rawTags === "string") tagValues = rawTags.split(/[,;|]/);
  else if (Array.isArray(rawTags)) tagValues = rawTags;
  else if (rawTags !== undefined && rawTags !== null) tagValues = [rawTags];

  const tags = tagValues
    .map((tag) => (typeof tag === "string" ? tag : String(tag ?? "")).trim())
    .filter(Boolean);

  const category =
    typeof rawCategory === "string"
      ? rawCategory.trim()
      : rawCategory === undefined || rawCategory === null
        ? ""
        : String(rawCategory).trim();

  return {
    title: asText(rawTitle),
    description: asText(rawDescription),
    tags,
    category: category || String(fallbackCategory || "").trim() || "Mature",
  };
}

/**
 * Near-misses the model produces, mapped onto the permitted vocabulary.
 * Keeping the mapping here (instead of rejecting the whole suggestion) is what
 * stops an off-list tag from throwing away a perfectly good AI title.
 */
const TAG_SYNONYMS: Record<string, string> = {
  milf: "mature",
  "mature woman": "mature",
  "older woman": "mature",
  gilf: "mature",
  homemade: "amateur",
  "real couple": "couples",
  couple: "couples",
  "amateur couple": "amateur",
  "point of view": "pov",
  "first person": "pov",
  girl: "solo",
  "solo female": "solo",
  girlgirl: "lesbian",
  "girl on girl": "lesbian",
  "two women": "lesbian",
  bdsm: "kinky",
  kink: "kinky",
  fetish: "kinky",
  bondage: "kinky",
  lingerie: "boudoir",
  "lingerie shoot": "boudoir",
  "date night": "romantic",
  "role play": "roleplay",
  cosplay: "roleplay",
  spa: "massage",
  sensual: "romantic",
  "1080p": "hd",
  uhd: "4k",
  "2160p": "4k",
  "high definition": "hd",
  "4k ultra hd": "4k",
  "4k uhd": "4k",
  exclusive: "featured",
  curated: "editorial",
  "staff pick": "featured",
};

/** Lower-cases, trims, and normalises separators so `Girl-On-Girl` matches. */
function tagKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Filters to the permitted list, dropping duplicates and empty tags. */
export function normalizeTags(rawTags: string[]): string[] {
  const allowed = new Set<string>(PERMITTED_TAGS);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of rawTags) {
    const key = tagKey(raw);
    if (!key) continue;
    const tag = allowed.has(key) ? key : TAG_SYNONYMS[key];
    if (!tag || !allowed.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/**
 * Permitted tags for a suggestion, with a category-derived floor.
 *
 * The floor exists so a model that answers with nothing on the list still
 * yields a usable, publishable tag set — the AI title and description are never
 * thrown away because of tags.
 */
function normalizeTagsWithFallback(rawTags: string[], category: string): string[] {
  const tags = normalizeTags(rawTags);
  if (tags.length) return tags;
  return normalizeTags([category, "editorial", "mature"]);
}

/** Normalises a category against the known Erobabe taxonomy. */
export function normalizeCategory(rawCategory: string, fallback: string): string {
  const wanted = String(rawCategory || "").trim().toLowerCase();
  const match = KNOWN_CATEGORIES.find((entry) => entry.toLowerCase() === wanted);
  if (match) return match;
  const fallbackMatch = KNOWN_CATEGORIES.find((entry) => entry.toLowerCase() === String(fallback || "").trim().toLowerCase());
  return fallbackMatch || "Mature";
}

/**
 * Validates and sanitises a model payload before it enters the publishing
 * workflow. Throws when the payload cannot produce a safe suggestion — the
 * caller decides between retrying and falling back.
 */
export function cleanSuggestion(value: unknown, fallbackCategory?: string): {
  title: string;
  description: string;
  tags: string[];
  category: string;
} {
  const validated = suggestionSchema.safeParse(coerceSuggestionInput(unwrapSuggestion(value), fallbackCategory));
  if (!validated.success) {
    const first = validated.error.issues[0];
    throw new Error(`incomplete suggestion (${first?.path?.join(".") || "invalid"}: ${first?.message || "invalid"})`);
  }

  const category = normalizeCategory(validated.data.category, fallbackCategory || "Mature");
  const tags = normalizeTagsWithFallback(validated.data.tags, category);

  return {
    title: validated.data.title,
    description: validated.data.description,
    tags,
    category,
  };
}

/* ------------------------------------------------------------------------- */
/* Key redaction                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Strips key material from anything that may reach a browser, a log, or an
 * audit row. Covers Google legacy `AIza…` / `AQ.…` keys, OpenRouter `sk-or-…`
 * keys, bearer tokens, and the env variable names people paste them next to.
 * Never returns the input key.
 */
export function redactKeyMaterial(text: unknown): string {
  return String(text ?? "")
    .replace(/AIza[0-9A-Za-z\-_]{10,}/gi, "<redacted>")
    .replace(/\bAQ\.[0-9A-Za-z._~-]{10,}/g, "<redacted>")
    .replace(/\bsk-or-[0-9A-Za-z._-]{10,}/g, "<redacted>")
    .replace(/((?:api[_-]?key|apikey|secret|token|bearer)\s*[:=]\s*)[^\s,;)]+/gi, "$1<redacted>")
    .replace(/Bearer\s+[^\s,;)]+/gi, "Bearer <redacted>");
}

/* ------------------------------------------------------------------------- */
/* Deterministic fallback                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Deterministic, non-AI metadata built from the file name and category.
 *
 * Used when OpenRouter is unavailable or keeps returning output we cannot
 * parse, so a publishing run is never blocked by the AI while still leaving
 * the admin something real to review and edit.
 */
export function fallbackSuggestion(sourceName: string, category?: string): SuggestedMetadata {
  const categoryLabel = normalizeCategory(String(category || ""), "Mature");
  const title = humanizeFileName(sourceName) || `${categoryLabel} video`;

  return {
    title: title.slice(0, MAX_TITLE_LENGTH),
    description: `${categoryLabel} video. AI metadata was unavailable, so this description was built from the file name — replace it before publishing.`,
    tags: normalizeTags([categoryLabel, "editorial", "mature"]),
    category: categoryLabel,
    reasoning: "Fallback metadata derived from the file name — AI metadata unavailable, requires human review",
  };
}

/** `evening_in_velvet-4k.mov` → `Evening In Velvet 4k`. */
export function humanizeFileName(sourceName: string): string {
  const base = String(sourceName || "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[._+]+/g, " ")
    .replace(/-+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s*[([{]\s*\d+\s*[)\]}]\s*/g, " ")
    .replace(/\b\d{5,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) return "";

  return base
    .split(" ")
    .slice(0, 12)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
