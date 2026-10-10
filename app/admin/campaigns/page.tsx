import { createServiceClient } from "@/lib/supabase/server";

export default async function CampaignsAdmin() {
  const supabase = createServiceClient();
  const { data: campaigns } = await supabase.from("campaigns").select("id, name, status, slot_id, start_date, end_date, price_cents, created_at").order("created_at", { ascending: false }).limit(100);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Campaigns</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real campaigns with concurrency-safe reservations</p>

      {(campaigns || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px]">No campaigns yet</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3">
              <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Slot</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Price</th></tr>
            </thead>
            <tbody>
              {(campaigns || []).map((c: any) => (
                <tr key={c.id} className="border-b border-line/50">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">Slot {c.slot_id}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">{c.status}</span></td>
                  <td className="px-4 py-3 text-[11px]">{c.start_date} → {c.end_date}</td>
                  <td className="px-4 py-3">${(c.price_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
