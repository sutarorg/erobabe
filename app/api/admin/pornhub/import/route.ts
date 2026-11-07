import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { configuredCategorySlugs, categorySource } from "@/lib/pornhub/categories";
import { createPornhubFetcher } from "@/lib/pornhub/client";
import {
  MAX_PAGES_PER_REQUEST,
  importCategorySlice,
  type ImportCursor,
} from "@/lib/pornhub/importer";
import type { ImportService } from "@/lib/catalog/counts";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Admin-triggered Pornhub import.
 *
 * One **slice** per request: the importer reads a few search-result pages and
 * reports the cursor where it stopped, and the dashboard calls again to
 * continue. That is what makes an unlimited run possible without any single
 * request running past its timeout — there is no "videos per category" cap
 * anywhere in this flow, and the caller only stops when the operator presses
 * Stop.
 *
 * `repair: true` (the panel's first slice) also resolves the poster of stored
 * rows that have none, so a grid imported before the poster rule fills in.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const CATEGORY_SLUG = /^[a-z0-9-]{2,40}$/;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function parseCursor(raw: unknown): ImportCursor | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as { source?: unknown; page?: unknown };
  const source = Number(value.source);
  const page = Number(value.page);
  if (!Number.isInteger(source) || source < 0 || !Number.isInteger(page) || page < 1) {
    return undefined;
  }
  return { source, page };
}

export async function POST(req: NextRequest) {
  try {
    const { service } = await requireActiveAdmin();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return badRequest("Invalid request");

    const slug = String(body.category || "").trim();
    if (!slug) return badRequest("Choose a category");
    if (!CATEGORY_SLUG.test(slug)) return badRequest("Invalid category");
    if (!categorySource(slug)) {
      return badRequest(
        `No Pornhub source is configured for "${slug}". Configured: ${configuredCategorySlugs().join(", ")}`,
      );
    }

    const pages = Math.max(
      1,
      Math.min(MAX_PAGES_PER_REQUEST, Math.floor(Number(body.pages) || 4)),
    );
    const dryRun = body.dryRun === true;
    const repair = body.repair === true;
    const rightsStatus = body.rightsStatus === "pending" ? "pending" : "cleared";

    const { data: categories, error } = await service
      .from("categories")
      .select("id, slug, label")
      .eq("slug", slug)
      .limit(1);
    if (error) throw error;
    const category = (categories || [])[0] as
      | { id: string; slug: string; label: string }
      | undefined;
    if (!category) return badRequest(`Unknown category: ${slug}`);

    const report = await importCategorySlice(
      {
        categorySlug: category.slug,
        cursor: parseCursor(body.cursor),
        pagesPerRequest: pages,
        dryRun,
        repair,
        rightsStatus,
        baseUrl: process.env.PORNHUB_BASE_URL || undefined,
      },
      {
        fetchPage: createPornhubFetcher({ baseUrl: process.env.PORNHUB_BASE_URL || undefined }),
        service: service as unknown as ImportService,
        categoryId: category.id,
      },
    );

    if (!dryRun && report.imported > 0) revalidatePublicTag("videos");
    return NextResponse.json({ report: { ...report, label: category.label } });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "The import failed") },
      { status: httpErrorStatus(error instanceof Error ? error.message : "") },
    );
  }
}
