import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, errorStatusFrom, requireActiveAdmin } from "@/lib/video/publishing";
import { UfoloadProvider } from "@/lib/video/ufoload";
import { startUfoloadUpload } from "@/lib/video/ufoload-flow";
import { MAX_VIDEO_SIZE } from "@/lib/video/storage";
import { UfoloadError, UFOLOAD_KEEPALIVE_INTERVAL_MS } from "@/lib/video/ufoload-protocol";

/** One control-plane round trip; the bytes never pass through this route. */
export const maxDuration = 60;

/**
 * Starts a UFOLOAD direct upload (documented step 1) for an authenticated
 * admin and returns only the temporary, upload-scoped material the browser
 * needs: the signed node URL, the grant header, the chunk parameters and the
 * upload/job ids.
 *
 * The server-only API key is never part of the response — the browser
 * authenticates to the upload node with the grant that UFOLOAD issued for this
 * one upload.
 *
 * The same endpoint doubles as the documented keep-alive: posting an existing
 * `uploadId` calls `GET /files/uploads/{id}` server-side, which keeps the
 * concurrent-upload slot alive and reports the state (`pending`, `completing`,
 * `completed`, `failed`, `aborted`).
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          error: "Send JSON, not the file itself",
          details: "Ask this route for an upload session, then PUT the file's chunks to the upload URL it returns.",
        },
        { status: 415 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const provider = new UfoloadProvider();

    // ---------------------------------------------------------- keep-alive
    const keepAliveId = typeof body.uploadId === "string" ? body.uploadId.trim() : "";
    if (keepAliveId) {
      provider.assertEnabled();
      const state = await provider.getUploadState(keepAliveId);
      return NextResponse.json({
        uploadId: keepAliveId,
        state: state.state,
        fileId: state.fileId,
        keepAlive: true,
        nextKeepAliveMs: UFOLOAD_KEEPALIVE_INTERVAL_MS,
      });
    }

    // ------------------------------------------------------- new session
    const fileName = String(body.fileName || "").trim().slice(0, 240);
    const fileSize = Number(body.fileSize);
    const mimeType = typeof body.mimeType === "string" ? body.mimeType.slice(0, 120) : undefined;

    if (!fileName) return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    if (!Number.isFinite(fileSize) || fileSize <= 0) return NextResponse.json({ error: "fileSize is required" }, { status: 400 });
    if (fileSize > MAX_VIDEO_SIZE) {
      return NextResponse.json({ error: "Video file is too large (max 2 GB)" }, { status: 413 });
    }

    provider.assertEnabled();
    const session = await startUfoloadUpload({ service, userId: user.id, provider, fileName, fileSize, mimeType });

    return NextResponse.json({
      ...session,
      // Advertised so the browser never has to guess when to ping.
      keepAliveIntervalMs: UFOLOAD_KEEPALIVE_INTERVAL_MS,
    });
  } catch (error: any) {
    const status = errorStatusFrom(error);
    const message =
      error instanceof UfoloadError && error.retryAfterSeconds
        ? `${errorMessageFrom(error, "UFOLOAD request failed")} Retry in about ${error.retryAfterSeconds}s.`
        : errorMessageFrom(error, "Could not start a UFOLOAD upload");
    return NextResponse.json({ error: message, ...(error?.code ? { code: error.code } : {}) }, { status });
  }
}
