import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { findDuplicateVideos } from "@/lib/video/duplicates";

/**
 * Duplicate pre-check for the publish page. Admin-only, read-only.
 * Body: { urls: string[] } → { matches: { [url]: DuplicateMatch } }
 */

const MAX_URLS = 50;

export async function POST(req: NextRequest) {
  try {
    const { service } = await requireActiveAdmin();
    const body = (await req.json().catch(() => null)) as { urls?: unknown } | null;
    const urls = Array.isArray(body?.urls) ? body.urls.map((value) => String(value ?? "").trim()).filter(Boolean) : [];
    if (!urls.length) return NextResponse.json({ matches: {} });
    if (urls.length > MAX_URLS) return NextResponse.json({ error: `Check up to ${MAX_URLS} links at a time` }, { status: 400 });

    const found = await findDuplicateVideos(service, urls.slice(0, MAX_URLS));
    return NextResponse.json({ matches: Object.fromEntries(found) });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Duplicate check failed") },
      { status: httpErrorStatus(error instanceof Error ? error.message : "") }
    );
  }
}
