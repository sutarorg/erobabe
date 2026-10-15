import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function redirectHome(request: NextRequest) {
  // Prefer the request origin so preview deployments redirect to themselves.
  const base = request.nextUrl.origin;
  try {
    return NextResponse.redirect(new URL("/", base), 303);
  } catch {
    return NextResponse.redirect(new URL("/", request.nextUrl.origin), 303);
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirectHome(request);
}

// GET cannot mutate a session (prefetch/crawlers must not sign users out).
export async function GET(request: NextRequest) {
  return redirectHome(request);
}
