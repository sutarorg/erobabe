import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site";
import { NextRequest, NextResponse } from "next/server";

function redirectHome(request: NextRequest) {
  // Prefer the request origin so preview deployments redirect to themselves.
  const base = getSiteUrl() || request.nextUrl.origin;
  try {
    return NextResponse.redirect(new URL("/", base));
  } catch {
    return NextResponse.redirect(new URL("/", request.nextUrl.origin));
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirectHome(request);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirectHome(request);
}
