import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, errorStatusFrom, requireActiveAdmin } from "@/lib/video/publishing";
import { StreamtapeProvider } from "@/lib/video/streamtape";
import { startStreamtapeUpload } from "@/lib/video/streamtape-flow";
import { StreamtapeError, redactSecrets } from "@/lib/video/streamtape-protocol";
import { streamtapeMaxUploadBytes } from "@/lib/video/streamtape";

/** One control-plane round trip; the bytes never pass through this route. */
export const maxDuration = 60;

/**
 * Starts a Streamtape direct upload (documented step 1) for an authenticated
 * admin and returns only the material the browser needs:
 *
 *   - `uploadUrl` — the streaming-relay address (`{STREAMTAPE_RELAY_URL}/upload/{token}`)
 *     that carries a signed, expiring, single-use token pointing at the node
 *     URL Streamtape returned from `GET /file/ul`;
 *   - the `uploadId`/`jobId` used later to complete the upload server-side.
 *
 * The server-only API credentials are never part of the response — the relay
 * verifies the app's HMAC signature and streams the multipart body straight to
 * the provider node, so video bytes never touch Next.js/Vercel.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          error: "Send JSON, not the file itself",
          details: "Ask this route for an upload session, then POST the multipart file to the uploadUrl it returns.",
        },
        { status: 415 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const fileName = String(body.fileName || "").trim().slice(0, 240);
    const fileSize = Number(body.fileSize);

    if (!fileName) return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    if (!Number.isFinite(fileSize) || fileSize <= 0) return NextResponse.json({ error: "fileSize is required" }, { status: 400 });

    const maxBytes = streamtapeMaxUploadBytes();
    if (fileSize > maxBytes) {
      return NextResponse.json(
        { error: `Video file is too large for this deployment (limit ${maxBytes} bytes — STREAMTAPE_MAX_UPLOAD_BYTES). Verify the account's real limit in the Streamtape panel and upload a smaller file.` },
        { status: 413 }
      );
    }

    const provider = new StreamtapeProvider();
    provider.assertEnabled();
    provider.assertRelayConfigured();

    const session = await startStreamtapeUpload({ service, userId: user.id, provider, fileName, fileSize });

    return NextResponse.json({
      jobId: session.jobId,
      uploadId: session.uploadId,
      uploadUrl: session.uploadUrl,
      expiresAt: session.expiresAt,
      maxBytes: session.maxBytes,
      fileName: session.fileName,
      fileSize: session.fileSize,
    });
  } catch (error: unknown) {
    const status = errorStatusFrom(error);
    const safeMessage = redactSecrets(errorMessageFrom(error, "Could not start a Streamtape upload"), [
      process.env.STREAMTAPE_API_KEY,
      process.env.STREAMTAPE_LOGIN,
      process.env.STREAMTAPE_RELAY_SECRET,
    ]);
    const message =
      error instanceof StreamtapeError && error.retryAfterSeconds
        ? `${safeMessage} Retry in about ${error.retryAfterSeconds}s.`
        : safeMessage;
    return NextResponse.json({ error: message, ...(error instanceof StreamtapeError && error.code ? { code: error.code } : {}) }, { status });
  }
}
