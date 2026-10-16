import { createHmac, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, limitRequest, RequestError } from "@/lib/http/safety";
import { createServiceClient } from "@/lib/supabase/server";
import { RECOMMENDATION_COOKIE, viewerHashFromCookie } from "@/lib/recommendations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ action: z.enum(["enable", "disable", "reset"]) }).strict();

function setCookie(response: NextResponse, token: string) {
  response.cookies.set(RECOMMENDATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}

export async function GET() {
  const hash = await viewerHashFromCookie();
  if (!hash) return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "private, no-store" } });
  try {
    const { data, error } = await createServiceClient().from("recommendation_preferences")
      .select("personalization_enabled,consent_expires_at")
      .eq("viewer_hash", hash).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ enabled: Boolean(data?.personalization_enabled && Date.parse(data.consent_expires_at) > Date.now()) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    await limitRequest(request, "recommendation-preferences", 12);
    const parsed = input.safeParse(await boundedJson(request, 1024));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const action = parsed.data.action;
    const previousHash = await viewerHashFromCookie();
    const db = createServiceClient();
    if (action === "disable") {
      if (previousHash) {
        const results = await Promise.all([
          db.from("recommendation_events").delete().eq("viewer_hash", previousHash),
          db.from("recommendation_feedback").delete().eq("viewer_hash", previousHash),
          db.from("recommendation_preferences").delete().eq("viewer_hash", previousHash),
        ]);
        if (results.some((result) => result.error)) throw new Error("Deletion incomplete");
      }
      const response = NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "private, no-store" } });
      response.cookies.set(RECOMMENDATION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
      return response;
    }

    const suppliedToken = request.cookies.get(RECOMMENDATION_COOKIE)?.value || "";
    const token = /^[A-Za-z0-9_-]{40,100}$/.test(suppliedToken)
      ? suppliedToken
      : randomBytes(32).toString("base64url");
    // Hash only the server-issued opaque cookie; it is not an account ID or proof of identity.
    const secret = process.env.ANALYTICS_HASH_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new RequestError("Service unavailable", 503);
    const viewerHash = createHmac("sha256", secret).update(`recommendation-profile:${token}`).digest("hex");
    const now = new Date().toISOString();
    const { error } = await db.from("recommendation_preferences").upsert({
      viewer_hash: viewerHash,
      personalization_enabled: true,
      ...(action === "reset" ? { preferred_category_ids: [], suppressed_category_ids: [] } : {}),
      consent_expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: now,
    }, { onConflict: "viewer_hash" });
    if (error) throw error;
    if (action === "reset") {
      const results = await Promise.all([
        db.from("recommendation_events").delete().eq("viewer_hash", viewerHash),
        db.from("recommendation_feedback").delete().eq("viewer_hash", viewerHash),
      ]);
      if (results.some((result) => result.error)) throw new Error("Reset incomplete");
    }
    const response = NextResponse.json({ enabled: true, reset: action === "reset" }, { headers: { "Cache-Control": "private, no-store" } });
    setCookie(response, token);
    return response;
  } catch (error) {
    return NextResponse.json({ error: "Unable to update recommendation settings" }, { status: error instanceof RequestError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
