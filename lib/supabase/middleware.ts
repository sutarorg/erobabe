import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function copySessionCookies(target: NextResponse, session: NextResponse) {
  for (const cookie of session.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

function redirectToSignIn(request: NextRequest, session: NextResponse) {
  const url = request.nextUrl.clone();
  // Staff and advertisers sign in on different pages: an admin hitting a
  // protected /admin path is sent to the admin page, everything else to the
  // advertiser portal's front door.
  url.pathname = request.nextUrl.pathname.startsWith("/admin")
    ? "/admin/signin"
    : "/auth/sign-in";
  url.searchParams.set("next", request.nextUrl.pathname);
  return copySessionCookies(NextResponse.redirect(url), session);
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
      return redirectToSignIn(request, supabaseResponse);
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
          cookiesToSet.forEach(({ name, value }: any) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }: any) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    // Refresh session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if ((isAdminRoute || isAdvertiserRoute) && !user) {
      return redirectToSignIn(request, supabaseResponse);
    }

    // Layouts can remain mounted during client navigation. Check current role
    // and suspension on EVERY protected request before service-backed pages run.
    if (user && (isAdminRoute || isAdvertiserRoute)) {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role, status")
        .eq("id", user.id)
        .single();
      if (error || !profile || profile.status !== "active") {
        return redirectToSignIn(request, supabaseResponse);
      }
      if (isAdvertiserRoute && profile.role === "admin") {
        const url = request.nextUrl.clone();
        url.pathname = "/admin";
        url.search = "";
        return copySessionCookies(NextResponse.redirect(url), supabaseResponse);
      }
      if (profile.role !== (isAdminRoute ? "admin" : "advertiser")) {
        return redirectToSignIn(request, supabaseResponse);
      }
    }
  } catch {
    console.error("[middleware] Protected session/profile verification failed");
    if (isAdminRoute || isAdvertiserRoute) {
      return redirectToSignIn(request, supabaseResponse);
    }
  }

  return supabaseResponse;
}
