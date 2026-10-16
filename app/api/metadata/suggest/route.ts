import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MetadataError,
  MIN_ATTEMPT_MS,
  SUGGESTION_BUDGET_MS,
  suggestVideoMetadata,
  type SuggestedMetadata,
} from "@/lib/metadata/openrouter";
import { normalizeTitleStyle, resolveTitleStyle } from "@/lib/metadata/title-style";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Admin-only category-led AI metadata suggestions (OpenRouter, NVIDIA Nemotron
 * 3 Ultra free route by default). Titles are written in the voice the site
 * publishes — `explicit`
 * unless `VIDEO_TITLE_STYLE` says otherwise. Length near-misses in the model's
 * reply are repaired rather than rejected (see `suggestVideoMetadata`); a title
 * is never composed offline. When OpenRouter is unreachable, out of credits, or
 * unwilling to write adults-only copy, this route answers with an error instead
 * of a filler title; the caller is expected to retry until the model answers.
 *
 * One request can ask for several drafts (`count`), because an upload batch
 * needs one title per file: that is what keeps a large queue inside the
 * per-administrator request budget instead of spending it — and the
 * administrator's afternoon — on request round trips.
 *
 * The upload flow can auto-publish after encoding, so the admin should preview
 * generated copy before starting an upload whenever possible.
 */

/** Most drafts one request may write, so a batch still answers well inside `maxDuration`. */
const MAX_BATCH = 4;

const bodySchema = z.object({
  title: z.string().max(160).optional().default(""),
  fileName: z.string().max(240).optional().default(""),
  category: z.string().max(80).optional().default(""),
  tags: z.string().max(240).optional().default(""),
  existingTitles: z.array(z.string().max(160)).max(100).optional().default([]),
  /** Optional per-request voice override; the server default wins when absent. */
  style: z.enum(["explicit", "editorial"]).optional(),
  /**
   * How many drafts to write in one request. A batch upload needs one title per
   * file, and asking for several at a time keeps a large queue from spending its
   * whole rate-limit budget (and minutes of encoding time) on request overhead.
   */
  count: z.number().int().min(1).max(MAX_BATCH).optional().default(1),
});

/** Bounded request body — suggestions need a few hundred bytes, not megabytes. */
const MAX_BODY_BYTES = 32 * 1024;

/** Simple per-user rate limit (per server instance). */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
/**
 * Requests one admin may start per minute. Bulk uploads ask for several drafts
 * per request, so this budget has to cover a batch, not a single file.
 */
const RATE_LIMIT_MAX = 60;
const requestLog = new Map<string, number[]>();

/**
 * Seconds until this user may ask again, or 0 when the request is allowed. A
 * refused request is never counted, so a client that waits the advertised
 * `Retry-After` is let through instead of being refused again.
 */
function rateLimitRetryAfter(userId: string): number {
  const now = Date.now();
  const entries = (requestLog.get(userId) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (entries.length >= RATE_LIMIT_MAX) {
    requestLog.set(userId, entries);
    return Math.max(1, Math.ceil((entries[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
  }
  entries.push(now);
  requestLog.set(userId, entries);
  return 0;
}

/**
 * Gives a slot back when generation failed.
 *
 * Without this, an OpenRouter outage turns the client's automatic retries into
 * a self-inflicted lockout: each failed attempt spends part of the budget, the
 * next attempt is answered 429, and the queue sits there reporting "too many
 * metadata requests" long after the budget window would have recovered. Only
 * requests that actually produced drafts are worth spending.
 */
function refundRateLimitSlot(userId: string): void {
  const entries = requestLog.get(userId);
  if (entries?.length) entries.pop();
}

/**
 * Model attempts must be settled this long after the request arrives, which
 * leaves the drafts and the response well inside `maxDuration`. A batch that
 * runs out of time returns the drafts it did write, so a large queue keeps
 * moving instead of waiting on one perfect response.
 */
const GENERATION_DEADLINE_MS = 52_000;

const VIDEO_TITLE_PAGE_SIZE = 1000;
// The video sitemap's current safety ceiling is 45,000 entries; retain a small
// margin so uniqueness checks cover the full live catalog without an unbounded scan.
const MAX_CATALOG_TITLES = 50_000;
const CATALOG_TITLE_CACHE_TTL_MS = 30_000;
const TITLE_RESERVATION_TTL_MS = 60 * 60 * 1000;
const MAX_TITLE_RESERVATIONS = 5000;
let catalogTitleCache: { loadedAt: number; titles: string[] } | null = null;
let catalogTitleLoad: Promise<string[]> | null = null;
let titleGenerationQueue: Promise<void> = Promise.resolve();
const titleReservations = new Map<string, { title: string; createdAt: number }>();

function titleKey(title: string): string {
  return title.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Read every catalog title in bounded PostgREST pages; reuse a brief process-local cache. */
async function loadCatalogTitles(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string[]> {
  if (catalogTitleCache && Date.now() - catalogTitleCache.loadedAt < CATALOG_TITLE_CACHE_TTL_MS) {
    return [...catalogTitleCache.titles];
  }
  if (catalogTitleLoad) return [...await catalogTitleLoad];

  const load = (async () => {
    const titles: string[] = [];
    for (let offset = 0; offset < MAX_CATALOG_TITLES; offset += VIDEO_TITLE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("videos")
        .select("title")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, Math.min(offset + VIDEO_TITLE_PAGE_SIZE, MAX_CATALOG_TITLES) - 1);
      if (error) throw error;
      const page = (data || []) as Array<{ title?: unknown }>;
      titles.push(...page.map((video) => String(video.title || "").trim()).filter(Boolean));
      if (page.length < VIDEO_TITLE_PAGE_SIZE) break;
    }
    return titles;
  })();
  catalogTitleLoad = load;
  try {
    const titles = await load;
    catalogTitleCache = { loadedAt: Date.now(), titles };
    return [...titles];
  } finally {
    if (catalogTitleLoad === load) catalogTitleLoad = null;
  }
}

function recentReservedTitles(): string[] {
  const now = Date.now();
  for (const [key, reservation] of titleReservations) {
    if (now - reservation.createdAt > TITLE_RESERVATION_TTL_MS) titleReservations.delete(key);
  }
  return Array.from(titleReservations.values(), ({ title }) => title).reverse();
}

function reserveTitle(title: string): void {
  const key = titleKey(title);
  if (!key) return;
  titleReservations.delete(key);
  titleReservations.set(key, { title, createdAt: Date.now() });
  while (titleReservations.size > MAX_TITLE_RESERVATIONS) {
    const oldest = titleReservations.keys().next().value;
    if (oldest === undefined) break;
    titleReservations.delete(oldest);
  }
}

/** Serialize local suggestions so concurrent admins on one instance see reservations. */
function serializeTitleGeneration<T>(generate: () => Promise<T>): Promise<T> {
  const result = titleGenerationQueue.then(generate, generate);
  titleGenerationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function POST(req: NextRequest) {
  const receivedAt = Date.now();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).single();
    if (!profile || profile.role !== "admin" || profile.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const retryAfter = rateLimitRetryAfter(user.id);
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: "Too many suggestion requests — try again shortly", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const rawBody = await req.text().catch(() => "");
    if (rawBody.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    let json: unknown = null;
    try {
      json = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const style = normalizeTitleStyle(parsed.data.style) ?? resolveTitleStyle();

    try {
      const outcome = await serializeTitleGeneration(async () => {
        // The catalog only feeds the duplicate checks, so a database hiccup must
        // not cost the upload its AI copy.
        const catalogTitles = await loadCatalogTitles(supabase).catch((error: unknown) => {
          console.warn(
            "[metadata/suggest] Catalog titles unavailable; checking the upload batch and recent titles only:",
            String((error as { message?: unknown } | null)?.message ?? error).slice(0, 200),
          );
          return [] as string[];
        });
        // Most relevant first: this upload batch (the client sends it oldest
        // first), then titles reserved on this instance, then the catalog, newest
        // first. The model sees the head of this list as its avoid list.
        const seenTitles = new Set<string>();
        const existingTitles = [
          ...[...parsed.data.existingTitles].reverse(),
          ...recentReservedTitles(),
          ...catalogTitles,
        ].filter((title) => {
          const key = titleKey(title);
          if (!key || seenTitles.has(key)) return false;
          seenTitles.add(key);
          return true;
        });
        // The admin-selected category alone informs the creative copy. Filename,
        // default title, and existing tags are intentionally not sent to AI.
        // A refused or unreachable model is never answered with an offline
        // composed title: the caller is expected to retry until OpenRouter
        // answers, so every published title is OpenRouter's own work.
        //
        // Each draft in a batch sees the drafts written before it, so one call
        // still returns several distinct titles. A batch that runs out of time
        // returns the drafts it did write: the client asks for the rest, and a
        // partial answer is far better than a stalled queue.
        const drafts: SuggestedMetadata[] = [];
        let failure: MetadataError | null = null;
        for (let index = 0; index < parsed.data.count; index += 1) {
          try {
            const draft = await suggestVideoMetadata({
              category: parsed.data.category,
              existingTitles: [...existingTitles, ...drafts.map((d) => d.title)],
              style,
              deadline: Math.min(
                Date.now() + SUGGESTION_BUDGET_MS,
                receivedAt + GENERATION_DEADLINE_MS,
              ),
            });
            reserveTitle(draft.title);
            drafts.push(draft);
          } catch (error: unknown) {
            if (!(error instanceof MetadataError)) throw error;
            failure = error;
            // Quota, auth and model errors will not fix themselves; stop asking
            // and report the first one rather than burning the budget further.
            if (
              error.code === "quota_exceeded" ||
              error.code === "not_configured" ||
              error.code === "model_unavailable" ||
              Date.now() + MIN_ATTEMPT_MS >= receivedAt + GENERATION_DEADLINE_MS
            )
              break;
          }
        }
        if (!drafts.length && failure) throw failure;
        return { suggestions: drafts };
      });
      return NextResponse.json({
        // `suggestion` stays the first draft so older callers keep working.
        suggestion: outcome.suggestions[0],
        suggestions: outcome.suggestions,
        source: "ai" as const,
        style,
        note: "Category-led AI draft in the site's title voice, checked against catalog titles; human review against the footage is recommended before starting an upload because completion auto-publishes. No search ranking is guaranteed.",
      });
    } catch (error: unknown) {
      if (error instanceof MetadataError) {
        // The caller is told to retry, so this attempt must not also spend the
        // request budget it is being asked to retry with.
        refundRateLimitSlot(user.id);
        return NextResponse.json(
          { error: error.message, code: error.code },
          {
            status: error.status,
            // An exhausted quota will not clear within the usual backoff, so
            // the retry waits rather than hammering OpenRouter every second.
            ...(error.code === "quota_exceeded"
              ? { headers: { "Retry-After": "30" } }
              : {}),
          },
        );
      }
      throw error;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
  }
}
