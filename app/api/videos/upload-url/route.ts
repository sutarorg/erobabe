import { NextRequest, NextResponse } from "next/server";
import {
  assertPublicHttpUrl,
  errorMessageFrom,
  errorStatusFrom,
  requireActiveAdmin,
  sourceNameFromUrl,
} from "@/lib/video/publishing";
import { startUfoloadImport } from "@/lib/video/ufoload-flow";
import { UfoloadProvider } from "@/lib/video/ufoload";
import { UfoloadError } from "@/lib/video/ufoload-protocol";
import { resolveThumbnailUrl } from "@/lib/video/storage";
import { normalizeRemoteEntries } from "@/lib/video/entries";

const MAX_URLS_PER_REQUEST = 20;

/** UFOLOAD's documented ceiling for simultaneous imports on one account. */
const MAX_ACTIVE_IMPORTS = 10;

/** Submission only — the download and encode happen on the provider's side. */
export const maxDuration = 60;

/**
 * Starts UFOLOAD URL imports (`POST /api/v1/files/import`).
 *
 * An import is asynchronous: UFOLOAD answers `202` with a *task*. The response
 * therefore reports `queued` — never `published` — and the video row stays
 * private until `/api/videos/status` sees the task finish, resolves the created
 * file id and the file itself reach `ready`.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

    const rawEntries = normalizeRemoteEntries(body);
    let urls: string[];
    try {
      urls = Array.from(new Set(rawEntries.map((entry) => assertPublicHttpUrl(entry.url, "Remote video URL"))));
    } catch (error) {
      // A mistyped or non-public link is the admin's input problem, not a 500.
      return NextResponse.json({ error: errorMessageFrom(error, "Invalid remote video URL") }, { status: 400 });
    }
    if (!urls.length) return NextResponse.json({ error: "Enter at least one remote video URL" }, { status: 400 });
    if (urls.length > MAX_URLS_PER_REQUEST) {
      return NextResponse.json({ error: `Upload up to ${MAX_URLS_PER_REQUEST} remote URLs at a time` }, { status: 400 });
    }
    if (urls.length > MAX_ACTIVE_IMPORTS) {
      return NextResponse.json(
        {
          error: `UFOLOAD allows ${MAX_ACTIVE_IMPORTS} active imports at once`,
          details: `Submit up to ${MAX_ACTIVE_IMPORTS} links, wait for them to finish, then submit the rest.`,
        },
        { status: 400 }
      );
    }

    const provider = new UfoloadProvider();
    provider.assertEnabled();

    // Resolve each distinct thumbnail once, then reuse it for its URLs.
    const thumbnailByPath = new Map<string, string | null>();
    const results: Array<Record<string, unknown>> = [];
    /** Set when UFOLOAD refuses more imports: stop instead of hammering it. */
    let blockedReason: string | null = null;

    for (const entry of rawEntries) {
      const remoteUrl = assertPublicHttpUrl(entry.url, "Remote video URL");

      if (blockedReason) {
        results.push({ remoteUrl, status: "failed", error: blockedReason });
        continue;
      }

      try {
        let thumbnailUrl: string | null = null;
        if (entry.thumbnailPath) {
          if (!thumbnailByPath.has(entry.thumbnailPath)) {
            thumbnailByPath.set(entry.thumbnailPath, resolveThumbnailUrl(service, user.id, entry.thumbnailPath));
          }
          thumbnailUrl = thumbnailByPath.get(entry.thumbnailPath) || null;
        }

        const name = sourceNameFromUrl(remoteUrl);
        const started = await startUfoloadImport({
          service,
          userId: user.id,
          provider,
          categoryId,
          remoteUrl,
          name,
          thumbnailUrl,
        });

        await service.from("audit_logs").insert({
          actor_id: user.id,
          action: "video_import_started",
          target_type: "video",
          target_id: started.video.id,
          level: "info",
          metadata: {
            provider: "ufoload",
            host: new URL(remoteUrl).hostname,
            import_task_id: started.importId,
            has_custom_thumbnail: Boolean(thumbnailUrl),
          },
        });

        results.push({
          remoteUrl,
          videoId: started.video.id,
          jobId: started.jobId,
          importId: started.importId,
          title: started.video.title,
          // Never "published": UFOLOAD has only accepted the task.
          status: "queued",
          providerStatus: started.providerStatus,
          metadataSource: started.metadata.source,
          ...(started.metadata.warning ? { metadataWarning: started.metadata.warning } : {}),
          processing: true,
        });
      } catch (error: any) {
        const concurrencyBlocked =
          error instanceof UfoloadError && (error.status === 409 || error.status === 429) && /import|concurrent|active/i.test(error.message);
        if (concurrencyBlocked) blockedReason = errorMessageFrom(error, "UFOLOAD is not accepting more imports right now.");
        results.push({
          remoteUrl,
          error: errorMessageFrom(error, "Unable to start the UFOLOAD import"),
          status: "failed",
        });
      }
    }

    const queued = results.filter((result) => result.status === "queued").length;
    return NextResponse.json(
      {
        results,
        queued,
        succeeded: queued,
        failed: results.length - queued,
        note:
          "UFOLOAD downloads and encodes in the background. Each row stays private until the provider reports the file as ready.",
      },
      { status: queued ? (queued === results.length ? 200 : 207) : 422 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "URL upload failed") },
      { status: errorStatusFrom(error) }
    );
  }
}
