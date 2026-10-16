import { createClient, createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient();
  const { data: campaigns } = await service
    .from("campaigns")
    .select(
      "id, name, slot_id, status, start_date, end_date, price_cents, impressions, clicks, payment_id, creative:ad_creatives(status)",
    )
    .eq("advertiser_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold">My Campaigns</h1>
        <Link
          href="/advertiser/campaigns/new"
          className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white"
        >
          New Campaign
        </Link>
      </div>

      {(campaigns || []).length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px] font-medium">No campaigns yet</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Reserve a slot and create your first campaign.
          </p>
        </div>
      ) : (
        <div className="mt-6 center-scroll overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Slot</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Spend</th>
              </tr>
            </thead>
            <tbody>
              {(campaigns || []).map((c: any) => (
                <tr key={c.id} className="border-b border-line/50">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">Slot {c.slot_id}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">
                      {c.status}
                    </span>
                    <p className="mt-2 text-[11px] text-ink-3">
                      Creative:{" "}
                      {(Array.isArray(c.creative) ? c.creative[0] : c.creative)
                        ?.status || "missing"}
                    </p>
                    {c.payment_id && (
                      <Link
                        href="/advertiser/billing"
                        className="mt-1 block text-accent"
                      >
                        Payment details
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px]">
                    {c.start_date} → {c.end_date}
                  </td>
                  <td className="px-4 py-3">
                    ${(c.price_cents / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
