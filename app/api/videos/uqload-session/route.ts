import { NextRequest, NextResponse } from "next/server";
import { getVideoProvider, UqloadProvider } from "@/lib/video/provider";
import { httpErrorStatus, requireActiveAdmin } from "@/lib/video/publishing";
import { MAX_VIDEO_SIZE } from "@/lib/video/storage";

/**
 * Hands an authenticated admin the Uqload upload-server URL and the form
 * fields Uqload requires, so the browser can POST the video bytes straight
 * to Uqload. The file never touches our host (and never hits a 4.5 MB
 * function-body limit or a Supabase bucket size cap).
 */
export async function POST(req: NextRequest) {
  try {
    await requireActiveAdmin();

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          error: "Send JSON, not the file itself",
          details: "Ask this route for an upload server, then POST the file directly to Uqload.",
        },
        { status: 415 }
      );
    }

    const body = await req.json().catch(() => null);
    const fileSize = Number(body?.fileSize);
    if (Number.isFinite(fileSize) && fileSize > MAX_VIDEO_SIZE) {
      return NextResponse.json({ error: "Video file is too large (max 2 GB)" }, { status: 400 });
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

    const session = await provider.getDirectUploadSession();
    return NextResponse.json(session);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not start a Uqload upload" }, { status: httpErrorStatus(error.message || "") });
  }
}
