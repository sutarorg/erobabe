import { NextRequest, NextResponse } from "next/server";
import { getVideoProvider, UqloadProvider } from "@/lib/video/provider";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";

/**
 * Confirms a video the browser just POSTed straight to Uqload.
 *
 * Uqload's upload server does not send CORS headers, so the browser cannot
 * read the JSON response that contains the filecode. Instead, the client polls
 * this route after sending the bytes; we look the file up in the account
 * library via the documented `file/list` endpoint (filtered by the `created`
 * "last X minutes" parameter and matched by title) and return its filecode.
 *
 * The client retries for a short window: the file lands in the library as
 * soon as the upload server accepts it, so the first or second poll normally
 * finds it. If nothing matching appears after the client gives up, the upload
 * either was not delivered or the title match failed — the admin is told to
 * check the Uqload account.
 */
export async function POST(req: NextRequest) {
  try {
    await requireActiveAdmin();

    const body = await req.json().catch(() => null);
    const title = typeof body?.fileTitle === "string" ? body.fileTitle.slice(0, 200) : "";
    const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 240) : "";
    if (!title && !fileName) {
      return NextResponse.json({ error: "Missing fileTitle or fileName" }, { status: 400 });
    }

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

    const found = await provider.findRecentUpload({ title, fileName });
    if (!found) return NextResponse.json({ found: false });

    return NextResponse.json({
      found: true,
      fileCode: found.fileCode,
      uploaded: found.uploaded || null,
      matchedBy: found.matchedBy,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not confirm the upload" }, { status: httpErrorStatus(error.message || "") });
  }
}
