import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { categorySource, configuredCategorySlugs } from "@/lib/damplips/categories";
import { createDamplipsFetcher } from "@/lib/damplips/client";
import { importCategorySlice, type ImportCursor } from "@/lib/damplips/importer";
import type { ImportService } from "@/lib/catalog/counts";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Unattended damplips fill for one category.
 *
 * The route keeps asking the importer for slices until every listing in the
 * category's plan has been walked or the time budget for this invocation is
 * spent. There is no per-run quota: the nightly job exists to keep adding new
 * posts, and everything already imported is skipped as a duplicate.
 *
 * Auth is the same Bearer `CRON_SECRET` as the retention jobs.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stop starting new slices after this long, leaving room to answer. */
const TIME_BUDGET_MS = 220_000;
/** Listing pages read per importer call. */
const PAGES_PER_SLICE = 3;
/** Post pages opened per importer call (the real cost of a slice). */
const POSTS_PER_SLICE = 10;

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
    let duplicates = 0;
    let repaired = 0;
    let pagesRead = 0;
    let postsRead = 0;
    const errors: string[] = [];
    let exhausted = false;

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const report = await importCategorySlice(
        {
          categorySlug: category.slug,
          cursor,
          pagesPerRequest: PAGES_PER_SLICE,
          postsPerRequest: POSTS_PER_SLICE,
          rightsStatus: "cleared",
          // A nightly pass also fixes stored rows whose poster went missing.
          repair: repaired === 0,
          baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
        },
        { fetchPage, service: importService, categoryId: category.id },
      );

      imported += report.imported;
      duplicates += report.duplicates;
      repaired += report.repaired;
      pagesRead += report.pagesRead;
      postsRead += report.postsRead;
      errors.push(...report.errors);
      cursor = report.cursor;
      exhausted = report.exhausted;

      // Nothing read at all: every listing has been walked, or the site refused
      // every page. Another slice would repeat the same work.
      if (exhausted || (report.pagesRead === 0 && report.postsRead === 0)) break;
      if (errors.length >= 25) break;
    }

    if (imported > 0) revalidatePublicTag("videos");

    return noStore({
      report: {
        category: category.slug,
        label: category.label,
        imported,
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
