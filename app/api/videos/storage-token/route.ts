import { NextRequest, NextResponse } from "next/server";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { cleanupTransitObjects, createThumbnailUploadTarget, createVideoUploadTarget } from "@/lib/video/storage";

/**
 * Issues a short-lived signed upload URL so the browser can push a video or a
 * thumbnail straight into Supabase Storage.
 *
 * This endpoint only ever exchanges JSON. Video bytes must not be posted to one
 * of our own routes: Vercel answers any function request body above 4.5 MB with
 * a plain-text `413 Request Entity Too Large`, which is what used to surface in
 * the admin UI as `Unexpected token 'R', "Request En"... is not valid JSON`.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Send JSON, not the file itself", details: "Request a signed upload URL here, then PUT the file to the returned uploadUrl." },
        { status: 415 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const kind = body.kind === "thumbnail" ? "thumbnail" : "video";
    const fileName = String(body.fileName || "").trim().slice(0, 240);
    const fileSize = Number(body.fileSize);
    const mimeType = String(body.mimeType || "").trim();
    if (!fileName) return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    if (!Number.isFinite(fileSize)) return NextResponse.json({ error: "fileSize is required" }, { status: 400 });

    const target =
      kind === "thumbnail"
        ? await createThumbnailUploadTarget({ service, userId: user.id, fileName, fileSize, mimeType })
        : await createVideoUploadTarget({ service, userId: user.id, fileName, fileSize, mimeType });

    if (kind === "video") {
      // Housekeeping: drop this admin's transit files from earlier sessions.
      cleanupTransitObjects(service, user.id).catch(() => {});
    }

    return NextResponse.json({ kind, ...target });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not prepare an upload" }, { status: httpErrorStatus(error.message || "") });
  }
}
