import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latestRecommendations, getRecommendationFeed } from "@/lib/recommendations/service";
import { limitRequest, RequestError } from "@/lib/http/safety";

export const dynamic = "force-dynamic";
const SURFACES = ["latest", "recommended", "up_next", "featured", "most_liked"] as const;
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const p = req.nextUrl.searchParams;
  const parsed = z.object({
    surface: z.enum(SURFACES).default("latest"),
    exclude: z.string().uuid().optional(),
    date: z.string().max(64).optional(),
    id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(24).default(16),
  }).safeParse(Object.fromEntries(p.entries()));
  if (!parsed.success || Boolean(parsed.data.date) !== Boolean(parsed.data.id)) return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  const { surface, exclude, date, id, limit } = parsed.data;
  try { await limitRequest(req, "recommendation-feed", 60); }
  catch (error) { return NextResponse.json({ error: "Feed unavailable" }, { status: error instanceof RequestError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } }); }
  if (surface === "latest") {
    if ((date && !z.string().datetime({ offset: true }).safeParse(date).success) || (exclude && !z.string().uuid().safeParse(exclude).success)) return NextResponse.json({ error: "Invalid page" }, { status: 400 });
    const result = await latestRecommendations({ exclude, cursor: date && id ? { date, id } : undefined, limit });
    console.info("[recommendations] feed", { surface, returned: result.videos.length, empty: !result.videos.length, latency_ms: Date.now() - startedAt });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (surface === "up_next" && !exclude) return NextResponse.json({ error: "Current video required" }, { status: 400 });
  if (date && !/^\d+(?:\.\d+)?$/.test(date)) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  try {
    const result = await getRecommendationFeed({
      surface,
      currentVideoId: exclude,
      cursor: date && id ? { date, id } : undefined,
      limit,
    });
    console.info("[recommendations] feed", { surface, version: result.algorithmVersion, returned: result.videos.length, empty: !result.videos.length, personalized: result.personalized, latency_ms: Date.now() - startedAt });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.warn("[recommendations] ranking-failed");
    return NextResponse.json({ error: "Unable to load recommendations" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
