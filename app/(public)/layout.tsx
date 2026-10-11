import PublicLayoutClient from "./PublicLayoutClient";
import { getActiveAds } from "@/lib/public/catalog";

export const revalidate = 60;

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const activeCampaigns = await getActiveAds();
  return <PublicLayoutClient activeCampaigns={activeCampaigns}>{children}</PublicLayoutClient>;
}
