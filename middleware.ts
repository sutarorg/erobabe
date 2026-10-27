import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/** The staff sign-in page must remain reachable without a session. */
const ADMIN_SIGNIN_PATH = /^\/admin\/sign-?in\/?$/;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminSignIn = ADMIN_SIGNIN_PATH.test(pathname);
  const isProtected = !isAdminSignIn && pathname.startsWith("/admin");

  // Advertising checkout is public and account-free. Only the staff dashboard
  // requires a refreshed, role-checked Supabase session.
  if (!isProtected) return NextResponse.next();
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
