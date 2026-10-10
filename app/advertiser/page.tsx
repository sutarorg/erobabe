import { createClient, createServiceClient } from "@/lib/supabase/server";

export default async function AdvertiserDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient();
  const [{ data: campaigns }, { data: slots }, { data: payments }] = await Promise.all([
    service.from("campaigns").select("*").eq("advertiser_id", user.id).order("created_at", { ascending: false }).limit(10),
    service.from("ad_slots").select("*").order("id"),
    service.from("payments").select("amount_cents, status").eq("advertiser_id", user.id),
  ]);

  const activeCampaigns = (campaigns || []).filter((c: any) => c.status === "active").length;
  const totalSpent = (payments || []).filter((p: any) => p.status === "confirmed").reduce((s: number, p: any) => s + p.amount_cents, 0);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Dashboard</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real data — no fake wallet, no invented metrics</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-line bg-pcard p-4">
          <p className="text-[11px] uppercase text-ink-3">Active Campaigns</p>
          <p className="mt-1 text-[22px] font-semibold">{activeCampaigns}</p>
        </div>
        <div className="rounded-lg border border-line bg-pcard p-4">
          <p className="text-[11px] uppercase text-ink-3">Total Spent (confirmed)</p>
          <p className="mt-1 text-[22px] font-semibold">${(totalSpent / 100).toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-line bg-pcard p-4">
          <p className="text-[11px] uppercase text-ink-3">Available Slots</p>
          <p className="mt-1 text-[22px] font-semibold">{slots?.length || 0}</p>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <h2 className="text-[13px] font-semibold">Recent Campaigns</h2>
        {(campaigns || []).length === 0 ? (
          <p className="mt-3 text-[12px] text-ink-3">No campaigns yet — reserve a slot to get started</p>
        ) : (
          <div className="mt-3 space-y-2">
            {(campaigns || []).map((c: any) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border border-line/50 bg-void px-3 py-2">
                <span className="text-[12px]">{c.name} — Slot {c.slot_id}</span>
                <span className="text-[10px] uppercase text-ink-3">{c.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
