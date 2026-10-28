import { headers } from "next/headers";
import PublicLayoutClient from "./PublicLayoutClient";
import RecommendationProfileInit from "@/src/components/RecommendationProfileInit";
import { getActiveAds } from "@/lib/public/catalog";
import { isSearchCrawler } from "@/lib/seo/crawlers";

export const revalidate = 60;

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const activeCampaigns = await getActiveAds();
  const userAgent = (await headers()).get("user-agent");
  return (
    <>
      <PublicLayoutClient
        activeCampaigns={activeCampaigns}
        skipAgeGate={isSearchCrawler(userAgent)}
      >
        {children}
      </PublicLayoutClient>
      {/* Issues the default-on personalization profile without making the
          document response uncacheable. */}
      <RecommendationProfileInit />
    </>
  );
}
