import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function copySessionCookies(target: NextResponse, session: NextResponse) {
  for (const cookie of session.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

function redirectToSignIn(request: NextRequest, session: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = "/admin/signin";
  url.searchParams.set("next", request.nextUrl.pathname);
  return copySessionCookies(NextResponse.redirect(url), session);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");

  if (!supabaseUrl || !supabaseKey) {
    if (isAdminRoute) return redirectToSignIn(request, supabaseResponse);
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value }: any) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: any) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (isAdminRoute && !user) return redirectToSignIn(request, supabaseResponse);

    // Layouts can remain mounted during client navigation. Check the current
    // staff role and suspension on every protected request.
    if (user && isAdminRoute) {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role, status")
        .eq("id", user.id)
        .single();
      if (error || !profile || profile.status !== "active" || profile.role !== "admin") {
        return redirectToSignIn(request, supabaseResponse);
      }
    }
  } catch {
    console.error("[middleware] Protected session/profile verification failed");
    if (isAdminRoute) return redirectToSignIn(request, supabaseResponse);
  }

  return supabaseResponse;
}
