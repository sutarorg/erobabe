import { NextRequest, NextResponse } from "next/server";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { createThumbnailUploadTarget } from "@/lib/video/storage";

/**
 * Issues a short-lived signed upload URL for a thumbnail image.
 *
 * Video files must not be posted here — they go directly to Uqload via
 * `/api/videos/uqload-session`. Thumbnails are small enough to live in
 * Supabase Storage.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireActiveAdmin();

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Send JSON, not the file itself", details: "Request a signed upload URL here, then PUT the thumbnail to the returned uploadUrl." },
        { status: 415 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    if (body.kind && body.kind !== "thumbnail") {
      return NextResponse.json(
        {
          error: "Video files upload directly to Uqload",
          details: "Request /api/videos/uqload-session and POST the file to the returned serverUrl. This route only issues thumbnail upload URLs.",
        },
        { status: 410 }
      );
    }

    const fileName = String(body.fileName || "").trim().slice(0, 240);
    const fileSize = Number(body.fileSize);
    const mimeType = String(body.mimeType || "").trim();
    if (!fileName) return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    if (!Number.isFinite(fileSize)) return NextResponse.json({ error: "fileSize is required" }, { status: 400 });

    const target = await createThumbnailUploadTarget({ service, userId: user.id, fileName, fileSize, mimeType });
    return NextResponse.json({ kind: "thumbnail", ...target });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not prepare an upload" }, { status: httpErrorStatus(error.message || "") });
  }
}
