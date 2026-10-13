import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * `/admin/signin` is the administrator sign-in page. It has to be reachable
 * *without* a session — it is the page that creates one — so it is excluded
 * from the protected `/admin` tree even though it sits on that path.
 */
const ADMIN_SIGNIN_PATH = /^\/admin\/sign-?in\/?$/;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminSignIn = ADMIN_SIGNIN_PATH.test(pathname);
  const isProtected = isAdminSignIn ? false : pathname.startsWith("/admin") || pathname.startsWith("/advertiser");

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
     * - api routes that need to bypass auth (nowpayments ipn)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/nowpayments/ipn|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
