import { createServiceClient } from "@/lib/supabase/server";

export default async function AdSlotsAdmin() {
  const supabase = createServiceClient();
  const { data: slots } = await supabase.from("ad_slots").select("*").order("id");

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Ad Slots — Fixed Inventory (10)</h1>
      <p className="mt-1 text-[12px] text-ink-3">Exactly ten fixed placements, 16:9, $99/month. Do not create additional public placements.</p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {(slots || []).map((s: any) => (
          <div key={s.id} className="rounded-lg border border-line bg-pcard p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium">Slot {s.id} — {s.name}</p>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">{s.side}</span>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">{s.description}</p>
            <p className="mt-2 text-[11px]">Price: ${(s.price_cents / 100).toFixed(2)}/mo</p>
            <p className="mt-1 text-[11px] uppercase text-ink-3">{s.status}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] text-amber-100/70">
        The ten placements are fixed inventory. Remove create-slot or delete-slot actions that would change total. Frontend must preserve 16:9 ratio.
      </div>
    </div>
  );
}
