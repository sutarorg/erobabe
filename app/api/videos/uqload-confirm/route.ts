import { NextRequest, NextResponse } from "next/server";
import { getVideoProvider, UqloadProvider } from "@/lib/video/provider";
import { expectedTitlesFor, pickConfirmedUpload } from "@/lib/video/uqload-match";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";

/**
 * Confirms a video the browser just POSTed straight to Uqload.
 *
 * Uqload's upload server does not send CORS headers, so the browser cannot read
 * the JSON response that contains the file code. The client instead:
 *
 *   1. asks for a `snapshot` of the account's file codes *before* sending the
 *      bytes,
 *   2. POSTs the file directly to Uqload,
 *   3. re-asks here (default mode) whether a code the snapshot did not contain
 *      has appeared in the library.
 *
 * Identification is always a library **diff** — never the title alone. Uqload
 * ignores multipart fields sent after the `file` part, so the stored title is
 * derived from the file name (`my trip.mp4` → `My_Trip`) and a cleaned title
 * can never match it; the title is only used to rank several new files. On the
 * final attempt the newest new code is accepted when the snapshot was readable,
 * so a late-landing upload is claimed instead of being reported as missing.
 */
export async function POST(req: NextRequest) {
  try {
    await requireActiveAdmin();

    const body = await req.json().catch(() => null);
    const mode = body?.mode === "snapshot" ? "snapshot" : "confirm";

    const provider = getVideoProvider("uqload");
    if (!provider.isEnabled() || !(provider instanceof UqloadProvider)) {
      return NextResponse.json(
        {
          error: "Uqload upload is not enabled",
          details:
            "Set UQLOAD_API_KEY and UQLOAD_ADULT_CONTENT_APPROVED=true only after obtaining the provider approval required for this content.",
        },
        { status: 503 }
      );
    }

    if (mode === "snapshot") {
      const files = await provider.listRecentUploads();
      return NextResponse.json({ fileCodes: files.map((file) => file.fileCode) });
    }

    const title = typeof body?.fileTitle === "string" ? body.fileTitle.slice(0, 200) : "";
    const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 240) : "";
    if (!title && !fileName) {
      return NextResponse.json({ error: "Missing fileTitle or fileName" }, { status: 400 });
    }

    // An array (even empty) means the pre-upload snapshot was readable; null
    // means it failed, so the caller must not let us guess the newest file.
    const knownFileCodes = Array.isArray(body?.knownFileCodes)
      ? body.knownFileCodes.filter((code: unknown) => typeof code === "string" && code).slice(0, 200)
      : null;

    const files = await provider.listRecentUploads();
    const found = pickConfirmedUpload({
      files,
      knownFileCodes,
      expectedTitles: expectedTitlesFor({ title, fileName }),
      finalAttempt: body?.finalAttempt === true,
    });

    const newFiles = files
      .filter((file) => !(knownFileCodes ?? []).includes(file.fileCode))
      .map((file) => ({ fileCode: file.fileCode, title: file.title, uploaded: file.uploaded ?? null, canPlay: Boolean(file.canPlay) }));

    if (!found) return NextResponse.json({ found: false, newFiles });
    return NextResponse.json({
      found: true,
      fileCode: found.fileCode,
      uploaded: found.uploaded || null,
      matchedBy: found.matchedBy,
      newFiles,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not confirm the upload" }, { status: httpErrorStatus(error.message || "") });
  }
}
