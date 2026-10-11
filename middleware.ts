import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = pathname.startsWith("/admin") || pathname.startsWith("/advertiser");

  // Public pages skip the Supabase round-trip so navigation stays instant.
  // Auth is still enforced on /admin and /advertiser.
  if (!isProtected) {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes that need to bypass auth (bcon callback)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/bcon/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
