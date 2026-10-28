import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { DAMPLIPS_CATEGORY_SOURCES, categorySource } from "@/lib/damplips/categories";
import { createDamplipsFetcher } from "@/lib/damplips/client";
import {
  AUTOPILOT_VIDEOS_PER_CATEGORY,
  importCategory,
  type ImportService,
} from "@/lib/damplips/importer";
import { revalidatePublicTag } from "@/lib/public/revalidate";

/**
 * Nightly damplips fill: 100 unique new videos per category at 00:00 IST.
 *
 * GitHub Actions calls this once per category so each invocation stays inside
 * the serverless timeout. Auth is the same Bearer `CRON_SECRET` as retention.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const given = Buffer.from(supplied);
  const expected = Buffer.from(secret);
  return Boolean(secret && given.length === expected.length && timingSafeEqual(given, expected));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: process.env.CRON_SECRET ? 401 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const slug = (request.nextUrl.searchParams.get("category") || "").trim();
  if (!slug || !categorySource(slug)) {
    return NextResponse.json(
      {
        error: "Choose a configured category",
        categories: DAMPLIPS_CATEGORY_SOURCES.map((entry) => entry.slug),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
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
    const category = (categories || [])[0] as { id: string; slug: string; label: string } | undefined;
    if (!category) {
      return NextResponse.json(
        { error: `Unknown category: ${slug}` },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const report = await importCategory(
      {
        categorySlug: category.slug,
        perCategory: AUTOPILOT_VIDEOS_PER_CATEGORY,
        rightsStatus: "cleared",
        baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
      },
      {
        fetchPage: createDamplipsFetcher({
          baseUrl: process.env.DAMPLIPS_BASE_URL || undefined,
        }),
        service: service as unknown as ImportService,
        categoryId: category.id,
      },
    );
    if (report.imported + report.updated > 0) revalidatePublicTag("videos");
    return NextResponse.json(
      { report: { ...report, category: category.slug, label: category.label } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The damplips import failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
