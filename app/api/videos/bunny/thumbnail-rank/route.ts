import { NextRequest, NextResponse } from "next/server";
import { requireActiveAdmin } from "@/lib/video/publishing";
import {
  frameCandidates,
  rankThumbnailCandidates,
  thumbnailVisionEnabled,
} from "@/lib/video/thumbnail-ranking";
import { providerError } from "@/lib/video/bunny";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    await requireActiveAdmin();
    if (!thumbnailVisionEnabled()) return NextResponse.json({ index: null });
    if (Number(req.headers.get("content-length")) > 700000)
      return NextResponse.json({ index: null }, { status: 413 });
    const text = await req.text();
    if (text.length > 700000)
      return NextResponse.json({ index: null }, { status: 413 });
    const input = frameCandidates.safeParse(JSON.parse(text).frames);
    if (!input.success)
      return NextResponse.json({ index: null }, { status: 400 });
    return NextResponse.json(
      { index: await rankThumbnailCandidates(input.data) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json(
      { error: r.error, index: null },
      { status: r.status },
    );
  }
}
