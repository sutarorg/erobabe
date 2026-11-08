import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { categorySource, configuredCategorySlugs } from "@/lib/damplips/categories";
import { createDamplipsFetcher } from "@/lib/damplips/client";
import {
  DEFAULT_PAGES_PER_REQUEST,
  DEFAULT_POSTS_PER_REQUEST,
  IMPORT_TARGET,
  MAX_IMPORT_TARGET,
  MAX_PAGES_PER_REQUEST,
  MAX_POSTS_PER_REQUEST,
  importCategorySlice,
  type ImportCursor,
} from "@/lib/damplips/importer";
import type { ImportService } from "@/lib/catalog/counts";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Admin-triggered damplips import.
 *
 * One **round** per request: the importer keeps reading listings and opening
 * post pages until it has written 100 new videos (or has genuinely walked
 * everything), then reports the cursor where it stopped. The dashboard calls
 * again to continue, so a run of any length is a sequence of finished rounds and
 * no single request runs past its timeout. There is no "videos per category"
 * cap anywhere in this flow, and the caller only stops when the operator presses
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

function clamp(value: unknown, fallback: number, max: number): number {
  const numeric = Math.floor(Number(value) || 0);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.min(max, numeric);
}

function parseCursor(raw: unknown): ImportCursor | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as {
    source?: unknown;
    page?: unknown;
    skip?: unknown;
    url?: unknown;
    queue?: unknown;
  };
  const source = Number(value.source);
  const page = Number(value.page);
  const skip = Number(value.skip ?? 0);
  if (
    !Number.isInteger(source) ||
    source < 0 ||
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(skip) ||
    skip < 0
  ) {
    return undefined;
  }
  const url = typeof value.url === "string" && value.url ? value.url : undefined;
  const queue = Array.isArray(value.queue)
    ? value.queue
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => /^\d{1,12}$/.test(entry))
        .slice(0, 160)
    : undefined;
  return {
    source,
    page,
    skip,
    ...(url ? { url } : {}),
    ...(queue && queue.length ? { queue } : {}),
  };
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
        `No damplips source is configured for "${slug}". Configured: ${configuredCategorySlugs().join(", ")}`,
      );
    }

    const target = clamp(body.target, IMPORT_TARGET, MAX_IMPORT_TARGET);
    const pages = clamp(body.pages, DEFAULT_PAGES_PER_REQUEST, MAX_PAGES_PER_REQUEST);
    const posts = clamp(body.posts, DEFAULT_POSTS_PER_REQUEST, MAX_POSTS_PER_REQUEST);
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
        importTarget: target,
        pagesPerRequest: pages,
        postsPerRequest: posts,
        dryRun,
        repair,
        // The host probe costs one extra request per video and the URL was
        // already parsed from a page that serves it; playback follows redirects.
        verifyMedia: body.verifyMedia === true,
        rightsStatus,
        baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
      },
      {
        fetchPage: createDamplipsFetcher({ baseUrl: process.env.DAMPLIPS_BASE_URL || undefined }),
        service: service as unknown as ImportService,
        categoryId: category.id,
      },
    );

    if (!dryRun && report.imported > 0) revalidatePublicTag("videos");
    return NextResponse.json({ report: { ...report, label: category.label } });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "The damplips import failed") },
      { status: httpErrorStatus(error instanceof Error ? error.message : "") },
    );
  }
}
