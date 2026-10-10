import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // If env not configured, still allow public routes, redirect protected to sign-in for E2E tests
    const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");
    const isAdvertiserRoute = request.nextUrl.pathname.startsWith("/advertiser");
    if (isAdminRoute || isAdvertiserRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/sign-in";
      url.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value, options }: any) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }: any) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes
  const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");
  const isAdvertiserRoute = request.nextUrl.pathname.startsWith("/advertiser");

  if ((isAdminRoute || isAdvertiserRoute) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Role check for admin routes (basic, full check in server components via RLS)
  if (isAdminRoute && user) {
    // We don't block here heavily, just let server components enforce via is_admin()
    // but we can redirect if needed. For now allow through.
  }

  return supabaseResponse;
}
