import { NextRequest, NextResponse } from "next/server";
import { errorMessageFrom, errorStatusFrom, requireActiveAdmin, updateUploadJob } from "@/lib/video/publishing";
import { UfoloadProvider } from "@/lib/video/ufoload";

/**
 * Cancels a UFOLOAD direct upload (`DELETE /files/uploads/{uploadID}`): the
 * partial data on the node is dropped and the concurrent-upload slot is freed.
 *
 * Cancelling is best effort — a session that already completed, or that expired
 * on its own, is not an error for the admin who clicked Cancel.
 */
export async function POST(req: NextRequest) {
  try {
    await requireActiveAdmin();

    const body = await req.json().catch(() => null);
    const uploadId = typeof body?.uploadId === "string" ? body.uploadId.trim() : "";
    if (!uploadId) return NextResponse.json({ error: "uploadId is required" }, { status: 400 });

    const provider = new UfoloadProvider();
    provider.assertEnabled();

    const cancelled = await provider.cancelDirectUpload(uploadId);
    return NextResponse.json({ uploadId, cancelled, state: cancelled ? "aborted" : "already-gone" });
  } catch (error: any) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Could not cancel the upload") },
      { status: errorStatusFrom(error) }
    );
  }
}

/** Marks the stored job as cancelled once the admin confirms the cancellation. */
export async function DELETE(req: NextRequest) {
  try {
    const { service } = await requireActiveAdmin();
    const jobId = new URL(req.url).searchParams.get("jobId") || "";
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

    await updateUploadJob(service, jobId, { status: "cancelled" });
    return NextResponse.json({ jobId, status: "cancelled" });
  } catch (error: any) {
    return NextResponse.json(
      { error: errorMessageFrom(error, "Could not update the upload job") },
      { status: errorStatusFrom(error) }
    );
  }
}
