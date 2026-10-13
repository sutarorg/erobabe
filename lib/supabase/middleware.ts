import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function redirectToSignIn(request: NextRequest) {
  const url = request.nextUrl.clone();
  // Staff and advertisers sign in on different pages: an admin hitting a
  // protected /admin path is sent to the admin page, everything else to the
  // advertiser portal's front door.
  url.pathname = request.nextUrl.pathname.startsWith("/admin") ? "/admin/signin" : "/auth/sign-in";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");
  const isAdvertiserRoute = request.nextUrl.pathname.startsWith("/advertiser");

  if (!supabaseUrl || !supabaseKey) {
    // If env not configured, still allow public routes, redirect protected to sign-in for E2E tests
    if (isAdminRoute || isAdvertiserRoute) {
      return redirectToSignIn(request);
    }
    return supabaseResponse;
  }

  // Never let a misconfigured or unreachable Supabase take the whole site down:
  // public routes are always served, protected routes fall back to sign-in.
  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value }: any) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }: any) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    // Refresh session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if ((isAdminRoute || isAdvertiserRoute) && !user) {
      return redirectToSignIn(request);
    }
  } catch (error) {
    console.error("[middleware] Supabase session refresh failed", error);
    if (isAdminRoute || isAdvertiserRoute) {
      return redirectToSignIn(request);
    }
  }

  return supabaseResponse;
}
