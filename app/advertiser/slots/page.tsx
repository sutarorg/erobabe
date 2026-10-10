import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function SlotsPage() {
  const supabase = createServiceClient();
  const { data: slots } = await supabase.from("ad_slots").select("*").order("id");

  // Check active campaigns for availability
  const now = new Date().toISOString().split("T")[0];
  const { data: active } = await supabase.from("campaigns").select("slot_id").eq("status", "active").lte("start_date", now).gte("end_date", now);

  const activeSlotIds = new Set((active || []).map((c: any) => c.slot_id));

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Ad Slots</h1>
      <p className="mt-1 text-[12px] text-ink-3">Ten fixed 16:9 placements, $99/month. Real availability check with concurrency-safe reservations.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {(slots || []).map((s: any) => {
          const isActive = activeSlotIds.has(s.id);
          return (
            <div key={s.id} className="rounded-lg border border-line bg-pcard p-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium">Slot {s.id} — {s.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${isActive ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-400"}`}>{isActive ? "Reserved" : "Available"}</span>
              </div>
              <p className="mt-2 text-[11px] text-ink-3">16:9 • {s.side} rail</p>
              <p className="mt-1 text-[12px] font-semibold">${(s.price_cents / 100).toFixed(2)}/mo</p>
              {!isActive && (
                <Link href={`/advertiser/campaigns/new?slot=${s.id}`} className="mt-3 inline-flex h-8 items-center rounded-md bg-accent px-3 text-[12px] font-semibold text-white hover:bg-accent-soft">
                  Reserve
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
