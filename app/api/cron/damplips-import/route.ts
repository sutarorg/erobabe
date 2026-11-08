import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { categorySource, configuredCategorySlugs } from "@/lib/damplips/categories";
import { createDamplipsFetcher } from "@/lib/damplips/client";
import { IMPORT_TARGET, importCategorySlice, type ImportCursor } from "@/lib/damplips/importer";
import type { ImportService } from "@/lib/catalog/counts";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Unattended damplips fill for one category.
 *
 * The job is measured in **rounds of 100 new videos**, not in pages read. A
 * slice keeps walking listings until it has written its round; this route calls
 * slices in a loop until the round is complete or its own time budget is spent,
 * so one nightly invocation adds at least its round instead of a handful of
 * rows. There is no per-run quota: everything already imported is skipped by
 * identity, and the next night continues from the same catalogue.
 *
 * Auth is the same Bearer `CRON_SECRET` as the retention jobs.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stop starting new slices after this long, leaving room to answer. */
const TIME_BUDGET_MS = 240_000;
/** Listing pages read per importer call. */
const PAGES_PER_SLICE = 12;
/** Post pages one importer call may open. */
const POSTS_PER_SLICE = 400;

function authorized(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const given = Buffer.from(supplied);
  const expected = Buffer.from(secret);
  return Boolean(secret && given.length === expected.length && timingSafeEqual(given, expected));
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return noStore({ error: "Unauthorized" }, process.env.CRON_SECRET ? 401 : 503);
  }

  const slug = (request.nextUrl.searchParams.get("category") || "").trim();
  if (!slug || !categorySource(slug)) {
    return noStore(
      { error: "Choose a configured category", categories: configuredCategorySlugs() },
      400,
    );
  }

  try {
    const service = createServiceClient();
    const { data: categories, error } = await service
      .from("categories")
      .select("id, slug, label")
      .eq("slug", slug)
      .limit(1);
    if (error) throw error;
    const category = (categories || [])[0] as
      | { id: string; slug: string; label: string }
      | undefined;
    if (!category) return noStore({ error: `Unknown category: ${slug}` }, 400);

    const fetchPage = createDamplipsFetcher({
      baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
    });
    const importService = service as unknown as ImportService;
    const startedAt = Date.now();

    let cursor: ImportCursor = { source: 0, page: 1, skip: 0 };
    let imported = 0;
    let uncategorised = 0;
    let duplicates = 0;
    let repaired = 0;
    let pagesRead = 0;
    let postsRead = 0;
    const errors: string[] = [];
    let exhausted = false;
    let targetReached = false;

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const report = await importCategorySlice(
        {
          categorySlug: category.slug,
          cursor,
          // The round this job exists to complete: 100 new videos.
          importTarget: IMPORT_TARGET - imported,
          pagesPerRequest: PAGES_PER_SLICE,
          postsPerRequest: POSTS_PER_SLICE,
          rightsStatus: "cleared",
          timeBudgetMs: Math.max(20_000, TIME_BUDGET_MS - (Date.now() - startedAt)),
          // A nightly pass also fixes stored rows whose poster went missing.
          repair: repaired === 0 && imported === 0,
          baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
        },
        { fetchPage, service: importService, categoryId: category.id },
      );

      imported += report.imported;
      uncategorised += report.uncategorised;
      duplicates += report.duplicates;
      repaired += report.repaired;
      pagesRead += report.pagesRead;
      postsRead += report.postsRead;
      errors.push(...report.errors);
      cursor = report.cursor;
      exhausted = report.exhausted;
      targetReached = imported >= IMPORT_TARGET;
      if (targetReached) break;

      // Nothing left to read at all: every listing walked and the related
      // frontier empty. Another slice would repeat the same work, so the round
      // stays short until the site publishes something new.
      if (exhausted) break;
      if (report.pagesRead === 0 && report.postsRead === 0) break;
      if (errors.length >= 25) break;
    }

    if (imported > 0) revalidatePublicTag("videos");

    return noStore({
      report: {
        category: category.slug,
        label: category.label,
        imported,
        target: IMPORT_TARGET,
        targetReached,
        uncategorised,
        duplicates,
        repaired,
        pagesRead,
        postsRead,
        cursor,
        exhausted,
        errors: errors.slice(0, 10),
      },
    });
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "The damplips import failed" },
      503,
    );
  }
}
