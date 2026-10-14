import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveAdmin, errorStatusFrom } from "@/lib/video/publishing";
import { boundedJson, RequestError } from "@/lib/http/safety";
import { revalidatePublicTag } from "@/lib/public/revalidate";
const schema = z
  .object({
    id: z.string().uuid(),
    action: z.enum([
      "approve_creative",
      "reject_creative",
      "pause_campaign",
      "resume_campaign",
      "cancel_campaign",
      "review_report",
      "resolve_report",
      "dismiss_report",
      "suspend_user",
      "restore_user",
    ]),
  })
  .strict();
export async function POST(req: Request) {
  try {
    const { user, service } = await requireActiveAdmin();
    const parsed = schema.safeParse(await boundedJson(req, 1024));
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    const { error } = await service.rpc("admin_transition", {
      p_admin: user.id,
      p_id: parsed.data.id,
      p_action: parsed.data.action,
    });
    if (error)
      return NextResponse.json(
        {
          error:
            "Transition not permitted. Recheck payment, dates, approval and inventory.",
        },
        { status: 409 },
      );
    revalidatePublicTag("ads");
    return NextResponse.json({ updated: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to perform action" },
      {
        status:
          error instanceof RequestError ? error.status : errorStatusFrom(error),
      },
    );
  }
}
