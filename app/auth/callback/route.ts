import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next =
    req.nextUrl.searchParams.get("next") === "/auth/update-password"
      ? "/auth/update-password"
      : "/";
  if (code) {
    const db = await createClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(new URL(next, req.nextUrl.origin), 303);
  }
  return NextResponse.redirect(
    new URL("/auth/sign-in?error=invalid_link", req.nextUrl.origin),
    303,
  );
}
