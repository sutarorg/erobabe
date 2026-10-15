import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MetadataError, suggestVideoMetadata } from "@/lib/metadata/openrouter";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Admin-only category-led AI metadata suggestions (OpenRouter, DeepSeek V3.2 by
 * default). The upload flow can auto-publish after encoding, so the admin should
 * preview/edit generated copy before starting an upload whenever possible.
 */

const bodySchema = z.object({
  title: z.string().max(160).optional().default(""),
  fileName: z.string().max(240).optional().default(""),
  category: z.string().max(80).optional().default(""),
  tags: z.string().max(240).optional().default(""),
  existingTitles: z.array(z.string().max(160)).max(100).optional().default([]),
});

/** Bounded request body — suggestions need a few hundred bytes, not megabytes. */
const MAX_BODY_BYTES = 32 * 1024;

/** Simple per-user rate limit (per server instance). */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const requestLog = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entries = (requestLog.get(userId) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  entries.push(now);
  requestLog.set(userId, entries);
  return entries.length > RATE_LIMIT_MAX;
}

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

    if (isRateLimited(user.id)) {
      return NextResponse.json({ error: "Too many suggestion requests — try again shortly" }, { status: 429 });
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

    try {
      const suggestion = await serializeTitleGeneration(async () => {
        const catalogTitles = await loadCatalogTitles(supabase);
        const seenTitles = new Set<string>();
        const existingTitles = [
          ...parsed.data.existingTitles,
          ...recentReservedTitles(),
          ...catalogTitles,
        ].filter((title) => {
          const key = titleKey(title);
          if (!key || seenTitles.has(key)) return false;
          seenTitles.add(key);
          return true;
        });
        const draft = await suggestVideoMetadata({
          // The admin-selected category alone informs the creative copy. Filename,
          // default title, and existing tags are intentionally not sent to AI.
          category: parsed.data.category,
          existingTitles,
        });
        reserveTitle(draft.title);
        return draft;
      });
      return NextResponse.json({
        suggestion,
        note: "Category-led AI draft checked against catalog titles; human review against the footage is recommended before starting an upload because completion auto-publishes. No search ranking is guaranteed.",
      });
    } catch (error: unknown) {
      if (error instanceof MetadataError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
  }
}
