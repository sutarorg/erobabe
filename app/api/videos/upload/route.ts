import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, errorStatusFrom, httpErrorStatus, isPreparedMetadata, requireActiveAdmin } from "@/lib/video/publishing";
import { completeStreamtapeUpload } from "@/lib/video/streamtape-flow";
import { StreamtapeProvider } from "@/lib/video/streamtape";
import { StreamtapeError, redactSecrets } from "@/lib/video/streamtape-protocol";
import { resolveThumbnailUrl } from "@/lib/video/storage";

/** Metadata generation plus the provider's confirmation handshake. */
export const maxDuration = 60;

/** Raw node responses are capped so a hostile body cannot bloat the request. */
const MAX_NODE_RESPONSE_BYTES = 16 * 1024;

/**
 * Finishes a Streamtape direct upload and attaches it to a video.
 *
 * The request is JSON and carries only the *session* id the server itself
 * handed out earlier (`/api/videos/streamtape-session`). The provider file id
 * is never accepted directly from the browser: an optional `nodeResponse`
 * (the upload node's verbatim reply, relayed by our own server code) may
 * contain a candidate id, which the flow confirms server-side with
 * `/file/info` — or resolves through an unambiguous folder listing.
 *
 * The video is created private and stays private until Streamtape reports the
 * file as converted; the admin UI polls `/api/videos/status` until then.
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          error: "Video files must not be posted to this route",
          details: "Ask /api/videos/streamtape-session for an upload session, POST the file to the returned uploadUrl, then send the uploadId here.",
        },
        { status: 415 }
      );
    }

    const { user, service } = await requireActiveAdmin();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    if (body.providerFileId || body.filecode || body.file_code || body.fileId) {
      return NextResponse.json(
        {
          error: "Provider file ids are not accepted from the browser",
          details:
            "Complete the upload with the uploadId returned by /api/videos/streamtape-session — any candidate id from the node response is confirmed server-side via /file/info.",
        },
        { status: 400 }
      );
    }

    const uploadId = String(body.uploadId || "").trim();
    if (!uploadId) {
      return NextResponse.json(
        {
          error: "uploadId is required",
          details: "Start the upload at /api/videos/streamtape-session before completing it here.",
        },
        { status: 400 }
      );
    }

    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

    const fileName = String(body.fileName || "").replace(/\s+/g, " ").trim().slice(0, 240) || "uploaded-video";
    const fileSize = Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null;

    const nodeResponse =
      typeof body.nodeResponse === "string" && body.nodeResponse.length <= MAX_NODE_RESPONSE_BYTES ? body.nodeResponse : null;

    let thumbnailUrl: string | null = null;
    try {
      // Only a thumbnail this admin uploaded through the signed-upload route
      // resolves; anything else is a bad request, not a server failure.
      thumbnailUrl = resolveThumbnailUrl(service, user.id, body.thumbnailPath ?? null);
    } catch (error) {
      return NextResponse.json({ error: errorMessageFrom(error, "Invalid thumbnail upload") }, { status: 400 });
    }

    const provider = new StreamtapeProvider();
    provider.assertEnabled();

    const result = await completeStreamtapeUpload({
      service,
      userId: user.id,
      provider,
      uploadId,
      categoryId,
      fileName,
      fileSize,
      thumbnailUrl,
      prepared: isPreparedMetadata(body.metadata) ? body.metadata : null,
      nodeResponse,
    });

    await service.from("audit_logs").insert({
      actor_id: user.id,
      action: "video_published_from_upload",
      target_type: "video",
      target_id: result.video.id,
      level: "info",
      metadata: {
        provider: "streamtape",
        file_name: fileName,
        file_size: fileSize,
        provider_file_id: result.providerFileId,
        provider_status: result.providerStatus,
        metadata_source: result.metadata.source,
      },
    });

    return NextResponse.json({
      videoId: result.video.id,
      jobId: result.jobId,
      providerFileId: result.providerFileId,
      embedUrl: result.embedUrl,
      playableUrl: result.playableUrl,
      providerStatus: result.providerStatus,
      status: result.readiness,
      video: result.video,
      metadata: result.metadata,
      metadataSource: result.metadata.source,
      ...(result.metadata.warning ? { metadataWarning: result.metadata.warning } : {}),
      // `processing` is expected: Streamtape still has to convert the file.
      processing: result.readiness !== "ready",
      progress: result.progress,
      ...(result.note ? { note: result.note } : {}),
      ...(result.error ? { providerError: result.error } : {}),
    });
  } catch (error: unknown) {
    const message = redactSecrets(errorMessageFrom(error, "Upload failed"), [
      process.env.STREAMTAPE_API_KEY,
      process.env.STREAMTAPE_LOGIN,
      process.env.STREAMTAPE_RELAY_SECRET,
    ]);
    return NextResponse.json(
      { error: message, ...(error instanceof StreamtapeError && error.code ? { code: error.code } : {}) },
      { status: errorStatusFrom(error) || httpErrorStatus(error instanceof Error ? error.message : "") }
    );
  }
}
