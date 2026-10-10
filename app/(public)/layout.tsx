import { createClient } from "@/lib/supabase/server";
import PublicLayoutClient from "./PublicLayoutClient";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  // Fetch public data for rails
  const { data: slots } = await supabase
    .from("ad_slots")
    .select("*")
    .order("id", { ascending: true })
    .limit(10);

  // Fetch active campaigns for slots (public view: only approved creatives)
  let activeCampaigns: any[] = [];
  try {
    const now = new Date().toISOString().split("T")[0];
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select(`
        id,
        slot_id,
        status,
        start_date,
        end_date,
        creative:ad_creatives(
          id,
          title,
          image_url,
          destination_url,
          status
        )
      `)
      .eq("status", "active")
      .lte("start_date", now)
      .gte("end_date", now);

    activeCampaigns = (campaigns || []).map((c: any) => ({
      slot_id: c.slot_id,
      creative: Array.isArray(c.creative) ? c.creative[0] : c.creative,
    })).filter((c: any) => c.creative?.status === "approved");
  } catch (e) {
    console.warn("Failed to fetch campaigns for rails", e);
  }

  return <PublicLayoutClient slots={slots || []} activeCampaigns={activeCampaigns}>{children}</PublicLayoutClient>;
}
