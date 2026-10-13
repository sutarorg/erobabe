import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, requireActiveAdmin, type ServiceClient } from "@/lib/video/publishing";
import { revalidatePublicTag } from "@/lib/public/revalidate";
import {
  importStreamtapeThumbnails,
  scanStreamtapeThumbnails,
  thumbnailFolderName,
  type ThumbnailTarget,
} from "@/lib/video/streamtape-thumbnails";
import { StreamtapeError } from "@/lib/video/streamtape";

/**
 * Admin-only bridge to the thumbnails kept in the Streamtape file manager.
 *
 * GET  — a dry run: which folder was found, how many images are in it, and
 *        which video each one would be attached to. Nothing is downloaded and
 *        nothing is written, so a misconfigured folder is cheap to diagnose.
 * POST — copies the matched images into Erobabe's own storage and writes the
 *        public URLs onto the video rows.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One request mirrors at most this many images. */
const MAX_IMPORT_PER_REQUEST = 25;
/** The dry run is read-only, so it may look at more rows. */
const MAX_SCAN_VIDEOS = 200;

const TARGET_SELECT = "id, slug, title, thumbnail_url, playable_url, source_key";
/** `source_key` arrives with migration 00000000000010 — optional for matching. */
const TARGET_SELECT_FALLBACK = "id, slug, title, thumbnail_url, playable_url";

function statusFor(error: unknown): number {
  if (error instanceof StreamtapeError) {
    switch (error.code) {
      case "not_configured":
        return 503;
      case "unauthorized":
        return 502;
      case "not_found":
        return 404;
      case "unreachable":
        return 504;
      case "bandwidth":
        return 503;
      default:
        return 502;
    }
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "Unauthorized") return 401;
  if (message.startsWith("Forbidden")) return 403;
  return 500;
}

type Row = {
  id: string;
  slug: string;
  title: string;
  thumbnail_url: string | null;
  playable_url?: string | null;
  source_key?: string | null;
};

function toTarget(row: any): ThumbnailTarget {
  return {
    id: String(row.id),
    slug: String(row.slug || row.id),
    title: String(row.title || "Untitled"),
    thumbnail_url: row.thumbnail_url || null,
    playable_url: row.playable_url || null,
    source_key: row.source_key || null,
  };
}

/**
 * Runs `build(select)` against `videos`, retrying without `source_key` on an
 * un-migrated database so a missing migration costs a weaker name match rather
 * than a failed import.
 */
async function selectVideos(
  service: ServiceClient,
  build: (select: string) => PromiseLike<{ data: any[] | null; error: any }>
): Promise<Row[]> {
  const withSource = await build(TARGET_SELECT);
  if (!withSource.error) return (withSource.data || []) as Row[];

  const without = await build(TARGET_SELECT_FALLBACK);
  if (without.error) throw without.error;
  return (without.data || []) as Row[];
}

async function loadTargets(service: ServiceClient, ids: string[] | null, overwrite: boolean): Promise<ThumbnailTarget[]> {
  return selectVideos(service, (select) => {
    let query = service.from("videos").select(select);

    if (ids) {
      query = query.in("id", [...new Set(ids)]);
    } else {
      // “Import all” means the videos that still need one. Videos that already
      // have a thumbnail are left alone unless the admin asked to overwrite.
      if (!overwrite) query = query.is("thumbnail_url", null);
      query = query.order("created_at", { ascending: false }).limit(MAX_IMPORT_PER_REQUEST);
    }

    return query as unknown as PromiseLike<{ data: any[] | null; error: any }>;
  }).then((rows) => rows.map(toTarget));
}

export async function GET() {
  try {
    const { service } = await requireActiveAdmin();
    const rows = await selectVideos(service, (select) =>
      service
        .from("videos")
        .select(select)
        .order("created_at", { ascending: false })
        .limit(MAX_SCAN_VIDEOS) as unknown as PromiseLike<{ data: any[] | null; error: any }>
    );

    const summary = await scanStreamtapeThumbnails(rows.map(toTarget), MAX_SCAN_VIDEOS);
    return NextResponse.json({ ...summary, folderName: thumbnailFolderName() });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Could not read the Streamtape thumbnails folder") },
      { status: statusFor(error) }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const body = (await req.json().catch(() => null)) as { ids?: unknown; overwrite?: unknown } | null;

    const rawIds = Array.isArray(body?.ids) ? body!.ids.map((value) => String(value ?? "").trim()) : null;
    if (rawIds && !rawIds.length) return NextResponse.json({ error: "Select at least one video" }, { status: 400 });
    if (rawIds && rawIds.length > MAX_IMPORT_PER_REQUEST) {
      return NextResponse.json(
        { error: `Import thumbnails for up to ${MAX_IMPORT_PER_REQUEST} videos at a time` },
        { status: 400 }
      );
    }
    if (rawIds && !rawIds.every((value) => UUID_PATTERN.test(value))) {
      return NextResponse.json({ error: "A valid video id is required" }, { status: 400 });
    }

    const overwrite = body?.overwrite === true;
    const targets = await loadTargets(service, rawIds, overwrite);
    if (!targets.length) {
      return NextResponse.json({
        results: [],
        imported: 0,
        note: overwrite
          ? "No videos to import."
          : "Every video already has a thumbnail. Tick “replace existing” to import anyway.",
      });
    }

    const summary = await importStreamtapeThumbnails(service, user.id, targets, {
      overwrite,
      maxVideos: MAX_IMPORT_PER_REQUEST,
    });

    if (summary.imported) revalidatePublicTag("videos");

    const failed = summary.results.filter((result) => result.status === "failed").length;
    const unmatched = summary.results.filter((result) => result.status === "unmatched").length;

    return NextResponse.json({
      ...summary,
      imported: summary.imported,
      failed,
      unmatched,
      folderName: thumbnailFolderName(),
      note:
        summary.imported > 0
          ? `Attached ${summary.imported} thumbnail${summary.imported === 1 ? "" : "s"} from the Streamtape file manager.${unmatched ? ` ${unmatched} had no matching image.` : ""}${failed ? ` ${failed} failed — see the row messages.` : ""}`
          : unmatched
            ? `No image in the Streamtape thumbnails folder matches the selected video${unmatched === 1 ? "" : "s"}. Names must match the video title or file name.`
            : failed
              ? "The thumbnails could not be imported — see the row messages."
              : "Nothing to import.",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Could not import thumbnails from Streamtape") },
      { status: statusFor(error) }
    );
  }
}
