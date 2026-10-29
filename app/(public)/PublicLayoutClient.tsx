"use client";

import { useMemo, useState } from "react";
import AdRail from "@/src/components/AdRail";
import Header, { type NavKey } from "@/src/components/Header";
import Footer from "@/src/components/Footer";
import AgeGate from "@/src/components/AgeGate";
import MobileAdsProvider from "@/src/components/ads/MobileAdsProvider";
import AdReviewNotice from "@/src/components/ads/AdReviewNotice";
import type { RotatableAd } from "@/lib/ads/rotation";
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

/** The ten creatives, reused by the mobile banners in a per-visitor rotation. */
export function mobileRotationPool(activeCampaigns: ActiveCampaign[]): RotatableAd[] {
  return activeCampaigns
    .filter((campaign) => campaign.creative?.image_url && campaign.creative?.destination_url)
    .map((campaign) => ({
      id: campaign.creative.id,
      campaign_id: campaign.campaign_id,
      title: campaign.creative.title || "Sponsored",
      image_url: campaign.creative.image_url,
      destination_url: campaign.creative.destination_url,
    }));
}

export default function PublicLayoutClient({
  children,
  activeCampaigns,
  skipAgeGate = false,
}: {
  children: React.ReactNode;
  activeCampaigns: ActiveCampaign[];
  /** Search crawlers index the same HTML without the 18+ overlay. */
  skipAgeGate?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pool = useMemo(() => mobileRotationPool(activeCampaigns), [activeCampaigns]);

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
    <MobileAdsProvider ads={pool}>
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
        {skipAgeGate ? null : <AgeGate />}
        {/* PayPal sends the advertiser back to the homepage; this shows the
            “In review” card once, for ten seconds, and then returns home. */}
        {skipAgeGate ? null : <AdReviewNotice />}
      </div>
    </MobileAdsProvider>
  );
}
