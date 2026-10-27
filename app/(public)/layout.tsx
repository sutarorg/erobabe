import PublicLayoutClient from "./PublicLayoutClient";
import RecommendationProfileInit from "@/src/components/RecommendationProfileInit";
import { getActiveAds } from "@/lib/public/catalog";

export const revalidate = 60;

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const activeCampaigns = await getActiveAds();
  return (
    <>
      <PublicLayoutClient activeCampaigns={activeCampaigns}>{children}</PublicLayoutClient>
      {/* Issues the default-on personalization profile without making the
          document response uncacheable. */}
      <RecommendationProfileInit />
    </>
  );
}
