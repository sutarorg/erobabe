import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { categorySource } from "@/lib/damplips/categories";
import { createDamplipsFetcher } from "@/lib/damplips/client";
import {
  MAX_VIDEOS_PER_CATEGORY,
  importCatalog,
  importCategory,
  type ImportService,
} from "@/lib/damplips/importer";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Admin-triggered damplips sync.
 *
 * One category per request keeps every invocation inside the platform timeout
 * and gives the operator per-category progress. `categories` is accepted for a
 * CLI-style full run, but the dashboard sends a single slug at a time.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const CATEGORY_SLUG = /^[a-z0-9-]{2,40}$/;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const { service } = await requireActiveAdmin();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return badRequest("Invalid request");

    const requested = Array.isArray(body.categories)
      ? body.categories.map((value) => String(value || "").trim())
      : [String(body.category || "").trim()];
    const slugs = [...new Set(requested.filter(Boolean))];
    if (!slugs.length) return badRequest("Choose a category");
    if (slugs.length > 12) return badRequest("Import up to 12 categories at a time");
    if (!slugs.every((slug) => CATEGORY_SLUG.test(slug))) return badRequest("Invalid category");
    const unknown = slugs.filter((slug) => !categorySource(slug));
    if (unknown.length) return badRequest(`No damplips source is configured for: ${unknown.join(", ")}`);

    const perCategory = Math.max(
      1,
      Math.min(MAX_VIDEOS_PER_CATEGORY, Math.floor(Number(body.perCategory) || 100)),
    );
    const dryRun = body.dryRun === true;
    const rightsStatus = body.rightsStatus === "pending" ? "pending" : "cleared";

    const { data: categories, error } = await service
      .from("categories")
      .select("id, slug, label")
      .in("slug", slugs);
    if (error) throw error;
    const found = (categories || []) as Array<{ id: string; slug: string; label: string }>;
    const missing = slugs.filter((slug) => !found.some((category) => category.slug === slug));
    if (missing.length) return badRequest(`Unknown category: ${missing.join(", ")}`);

    const fetchPage = createDamplipsFetcher({
      baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
    });
    const importService = service as unknown as ImportService;

    if (found.length === 1) {
      const category = found[0];
      const report = await importCategory(
        {
          categorySlug: category.slug,
          perCategory,
          dryRun,
          rightsStatus,
          baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
        },
        { fetchPage, service: importService, categoryId: category.id },
      );
      if (!dryRun && report.imported + report.updated > 0) revalidatePublicTag("videos");
      return NextResponse.json({
        report: { ...report, category: category.slug, label: category.label },
      });
    }

    const ordered = slugs
      .map((slug) => found.find((category) => category.slug === slug))
      .filter((category): category is { id: string; slug: string; label: string } => Boolean(category));
    const run = await importCatalog(
      {
        categories: ordered,
        perCategory,
        dryRun,
        rightsStatus,
        baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
      },
      { fetchPage, service: importService },
    );
    if (!dryRun) revalidatePublicTag("videos");
    return NextResponse.json({ run });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "The damplips import failed") },
      { status: httpErrorStatus(error instanceof Error ? error.message : "") },
    );
  }
}
