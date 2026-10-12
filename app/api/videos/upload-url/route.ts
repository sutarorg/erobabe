import { NextRequest, NextResponse } from "next/server";
import {
  assertPublicHttpUrl,
  errorMessageFrom,
  errorStatusFrom,
  requireActiveAdmin,
  sourceNameFromUrl,
} from "@/lib/video/publishing";
import { startStreamtapeImport } from "@/lib/video/streamtape-flow";
import { StreamtapeProvider } from "@/lib/video/streamtape";
import { StreamtapeError, redactSecrets } from "@/lib/video/streamtape-protocol";
import { resolveThumbnailUrl } from "@/lib/video/storage";
import { normalizeRemoteEntries } from "@/lib/video/entries";

const MAX_URLS_PER_REQUEST = 20;

/**
 * App-level ceiling on concurrently tracked remote imports. Streamtape does
 * not document a concurrent-remote-upload limit (verified 2026-10-12 — see
 * docs/STREAMTAPE_MIGRATION.md), so this is a safety valve of ours, not a
 * claimed provider limit; tune it with STREAMTAPE_MAX_ACTIVE_IMPORTS.
 */
const DEFAULT_MAX_ACTIVE_IMPORTS = 10;

function maxActiveImports(): number {
  const raw = Number(String(process.env.STREAMTAPE_MAX_ACTIVE_IMPORTS || "").trim());
  if (Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  return DEFAULT_MAX_ACTIVE_IMPORTS;
}

/** Submission only — the download and encode happen on the provider's side. */
export const maxDuration = 60;

/**
 * Starts Streamtape remote uploads (`remotedl/add`).
 *
 * An import is asynchronous: Streamtape answers with a *task*. The response
 * therefore reports `queued` — never `published` — and the video row stays
 * private until `/api/videos/status` sees the task finish, resolves the
 * created file id, and the file itself converts. Allowed URL schemes/hosts are
 * validated by `assertPublicHttpUrl` (public http/https only — no localhost,
 * no RFC1918, no embedded credentials).
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

    const activeLimit = maxActiveImports();
    if (urls.length > activeLimit) {
      return NextResponse.json(
        {
          error: `Submit at most ${activeLimit} links at once (STREAMTAPE_MAX_ACTIVE_IMPORTS safety limit)`,
          details: `Submit up to ${activeLimit} links, wait for them to finish, then submit the rest.`,
        },
        { status: 400 }
      );
    }

    const provider = new StreamtapeProvider();
    provider.assertEnabled();

    // Resolve each distinct thumbnail once, then reuse it for its URLs.
    const thumbnailByPath = new Map<string, string | null>();
    const results: Array<Record<string, unknown>> = [];
    /** Set when Streamtape refuses more tasks: stop instead of hammering it. */
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
        const started = await startStreamtapeImport({
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
            provider: "streamtape",
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
          // Never "published": Streamtape has only accepted the task.
          status: "queued",
          providerStatus: started.providerStatus,
          metadataSource: started.metadata.source,
          ...(started.metadata.warning ? { metadataWarning: started.metadata.warning } : {}),
          processing: true,
        });
      } catch (error: unknown) {
        const rateBlocked =
          error instanceof StreamtapeError && (error.status === 429 || error.status === 509 || error.status === 403);
        if (rateBlocked) blockedReason = redactSecrets(errorMessageFrom(error, "Streamtape is not accepting more remote uploads right now."), [
          process.env.STREAMTAPE_API_KEY,
          process.env.STREAMTAPE_LOGIN,
        ]);
        results.push({
          remoteUrl,
          error: redactSecrets(errorMessageFrom(error, "Unable to start the Streamtape remote upload"), [
            process.env.STREAMTAPE_API_KEY,
            process.env.STREAMTAPE_LOGIN,
          ]),
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
          "Streamtape downloads and converts in the background. Each row stays private until the provider reports the file as converted.",
      },
      { status: queued ? (queued === results.length ? 200 : 207) : 422 }
    );
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessageFrom(error, "URL upload failed") }, { status: errorStatusFrom(error) });
  }
}
