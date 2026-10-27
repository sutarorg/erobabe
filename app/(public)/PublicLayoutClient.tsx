"use client";

import { useCallback, useEffect, useState } from "react";
import AdRail from "@/src/components/AdRail";
import Header, { type HeaderUser, type NavKey } from "@/src/components/Header";
import Footer from "@/src/components/Footer";
import AgeGate from "@/src/components/AgeGate";
import { useRouter, usePathname } from "next/navigation";

interface ActiveCampaign {
  campaign_id?: string;
  slot_id: number;
  creative: {
    id: string;
    title: string;
    image_url: string;
    destination_url: string;
    status: string;
  };
}

/**
 * Which primary-navigation item owns the current route.
 *
 * Returns `null` for anything that is not one of the four (`/about`, `/privacy`,
 * `/terms`, `/contact`, `/faq`, `/content-removal`, `/video/[slug]`, …) so the
 * header does not light up “Home” on pages Home does not own.
 */
export function navForPath(pathname: string | null): NavKey | null {
  const path = String(pathname || "");
  if (!path || path === "/") return "home";
  if (path.startsWith("/categories") || path.startsWith("/category")) return "categories";
  if (path.startsWith("/latest")) return "latest";
  if (path.startsWith("/popular")) return "toprated";
  return null;
}

export default function PublicLayoutClient({
  children,
  activeCampaigns,
}: {
  children: React.ReactNode;
  activeCampaigns: ActiveCampaign[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<HeaderUser | null>(null);

  /**
   * Reads the visitor's session in the browser.
   *
   * The public pages deliberately skip the middleware session refresh so
   * navigation stays instant, so the header resolves the account itself: a
   * signed-in admin is offered the staff dashboard instead of a "Sign in"
   * button. A missing or failing Supabase configuration is not an
   * error here — the header simply stays signed out.
   */
  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    async function load() {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        const account = data?.user;
        if (cancelled) return;
        if (!account) {
          setUser(null);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role, display_name, company_name, email")
          .eq("id", account.id)
          .maybeSingle();
        if (cancelled) return;

        const name =
          (profile as any)?.display_name ||
          (profile as any)?.company_name ||
          (profile as any)?.email ||
          account.email ||
          "Account";

        setUser({ name: String(name), role: (profile as any)?.role ?? null });
      } catch {
        if (!cancelled) setUser(null);
      }
    }

    void load();

    // Keep the header honest across sign-ins and sign-outs in other tabs.
    void (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!session?.user) {
            setUser(null);
            return;
          }
          void load();
        });
        subscription = data?.subscription ?? null;
        if (cancelled) subscription?.unsubscribe();
      } catch {
        /* Supabase not configured — the header stays signed out. */
      }
    })();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const navigate = (key: NavKey) => {
    setQuery("");
    switch (key) {
      case "home":
        router.push("/");
        break;
      case "categories":
        router.push("/categories");
        break;
      case "latest":
        router.push("/latest");
        break;
      case "toprated":
        router.push("/popular");
        break;
    }
  };

  const handleSearch = (q: string) => {
    setQuery(q);
    if (q.trim()) {
      router.push(`/?q=${encodeURIComponent(q.trim())}`);
    }
  };

  const handleSignOut = useCallback(async () => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      /* Not configured — nothing to sign out of. */
    }
    setUser(null);
    router.push("/");
    router.refresh();
  }, [router]);

  return (
    <div className="grid h-screen grid-cols-1 bg-void text-ink min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)]">
      <AdRail side="left" start={1} activeCampaigns={activeCampaigns} />

      <main className="no-scrollbar @container relative h-screen min-h-0 min-w-0 overflow-y-auto bg-panel">
        <Header
          navActive={navForPath(pathname)}
          onNavigate={navigate}
          query={query}
          onQueryChange={handleSearch}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          user={user}
          onSignInClick={() => router.push("/auth/sign-in")}
          onSignOut={handleSignOut}
          useLinks
        />
        <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 @sm:px-5 @2xl:px-7">
          {children}
        </div>
        <Footer
          onNavigate={navigate}
          onOpenPage={(p) => router.push(p === "removal" ? "/content-removal" : `/${p}`)}
          onAdvertise={() => router.push("/checkout")}
          useLinks
        />
      </main>

      <AdRail side="right" start={6} activeCampaigns={activeCampaigns} />
      <AgeGate />
    </div>
  );
}
