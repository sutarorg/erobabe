import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, limitRequest, RequestError } from "@/lib/http/safety";
import { createServiceClient } from "@/lib/supabase/server";
export async function POST(req: Request) {
  try {
    const parsed = z
      .object({ videoId: z.string().uuid() })
      .strict()
      .safeParse(await boundedJson(req, 512));
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid view" }, { status: 400 });
    const hash = await limitRequest(req, "video-view", 30);
    const { data, error } = await createServiceClient().rpc(
      "record_video_view",
      { p_video: parsed.data.videoId, p_visitor: hash },
    );
    if (error) throw error;
    return NextResponse.json({ recorded: data === true });
  } catch (error) {
    return NextResponse.json(
      { error: "View unavailable" },
      { status: error instanceof RequestError ? error.status : 503 },
    );
  }
}
