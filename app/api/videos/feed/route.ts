import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { watchFeed } from "@/lib/public/watch-feed";
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const parsed = z.object({ exclude: z.string().uuid(), date: z.string().datetime({ offset: true }).optional(), id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(16) }).safeParse({ exclude: p.get("exclude"), date: p.get("date") || undefined, id: p.get("id") || undefined, limit: p.get("limit") || 16 });
  if (!parsed.success || Boolean(parsed.data.date) !== Boolean(parsed.data.id)) return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  try {
    const { exclude, date, id, limit } = parsed.data;
    return NextResponse.json(await watchFeed("latest", exclude, date && id ? { date, id } : undefined, limit));
  } catch { return NextResponse.json({ error: "Unable to load videos" }, { status: 503 }); }
}
