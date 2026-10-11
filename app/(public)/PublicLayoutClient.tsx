"use client";

import { useState } from "react";
import AdRail from "@/src/components/AdRail";
import Header from "@/src/components/Header";
import Footer from "@/src/components/Footer";
import AgeGate from "@/src/components/AgeGate";
import type { NavKey } from "@/src/components/Header";
import { useRouter, usePathname } from "next/navigation";

interface ActiveCampaign {
  slot_id: number;
  creative: {
    id: string;
    title: string;
    image_url: string;
    destination_url: string;
    status: string;
  };
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

  const navForPath = (): NavKey => {
    if (pathname === "/") return "home";
    if (pathname.startsWith("/categories") || pathname.startsWith("/category")) return "categories";
    if (pathname.startsWith("/latest")) return "latest";
    if (pathname.startsWith("/popular")) return "toprated";
    return "home";
  };

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

  return (
    <div className="grid h-screen grid-cols-1 bg-void text-ink min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)]">
      <AdRail side="left" start={1} onAdvertise={() => router.push("/advertiser")} activeCampaigns={activeCampaigns} />

      <main className="no-scrollbar @container relative h-screen min-h-0 min-w-0 overflow-y-auto bg-panel">
        <Header
          navActive={navForPath()}
          onNavigate={navigate}
          query={query}
          onQueryChange={handleSearch}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          user={null}
          onSignInClick={() => router.push("/auth/sign-in")}
          onSignOut={() => {}}
          useLinks
        />
        <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 @sm:px-5 @2xl:px-7">
          {children}
        </div>
        <Footer
          onNavigate={navigate}
          onOpenPage={(p) => router.push(p === "removal" ? "/content-removal" : `/${p}`)}
          onAdvertise={() => router.push("/advertiser")}
          onAdmin={() => router.push("/admin")}
          useLinks
        />
      </main>

      <AdRail side="right" start={6} onAdvertise={() => router.push("/advertiser")} activeCampaigns={activeCampaigns} />
      <AgeGate />
    </div>
  );
}
