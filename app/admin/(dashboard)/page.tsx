import Link from "next/link";
import { tryCreateServiceClient } from "@/lib/supabase/server";
import {
  loadAdRevenueSummary,
  loadInventory,
  slotBoardRows,
  type AdRevenueSummary,
  type SlotBoardRow,
} from "@/lib/ads/inventory";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const supabase = tryCreateServiceClient();

  if (!supabase) {
    return (
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-[12px] leading-relaxed text-amber-200">
          Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the
          deployment environment to load the catalog, the ad orders and the revenue figures.
        </p>
      </div>
    );
  }

  const [
    { count: videoCount },
    { count: publishedCount },
    { data: recentVideos },
    { count: reviewCount },
    { data: recentOrders },
  ] = await Promise.all([
    supabase.from("videos").select("*", { count: "exact", head: true }),
    supabase.from("videos").select("*", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("videos").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("ad_orders").select("*", { count: "exact", head: true }).eq("status", "in_review"),
    supabase.from("ad_orders").select("id, ad_name, status, payment_status, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  // Occupancy comes from the same resolver the checkout and the public rails
  // use, so the dashboard can never disagree with what is actually sellable.
  let slots: SlotBoardRow[] = [];
  let revenue: AdRevenueSummary = {
    verifiedCents: 0,
    verifiedOrders: 0,
    refundedCents: 0,
    refundedOrders: 0,
  };
  try {
    slots = slotBoardRows(await loadInventory());
  } catch {
    slots = [];
  }
  try {
    revenue = await loadAdRevenueSummary();
  } catch {
    /* the cards below stay at zero and say so */
  }

  const availableSlots = slots.filter((slot) => !slot.taken).length;

  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">Live content and guest advertising orders</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[11px] uppercase tracking-wider text-ink-3">Total Videos</p><p className="mt-1 text-[22px] font-semibold">{videoCount || 0}</p><p className="mt-1 text-[11px] text-ink-3">{publishedCount || 0} published</p></div>
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[11px] uppercase tracking-wider text-ink-3">Ad Slots</p><p className="mt-1 text-[22px] font-semibold">{slots.length ? `${availableSlots}/${slots.length}` : "—"}</p><p className="mt-1 text-[11px] text-ink-3">Available · fixed inventory</p></div>
        <Link href="/admin/advertisements" className="rounded-lg border border-line bg-pcard p-4 transition hover:border-accent/40"><p className="text-[11px] uppercase tracking-wider text-ink-3">Ads In Review</p><p className="mt-1 text-[22px] font-semibold">{reviewCount || 0}</p><p className="mt-1 text-[11px] text-accent">Review payments & creatives</p></Link>
        <div className="rounded-lg border border-line bg-pcard p-4">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Verified Ad Revenue</p>
          <p className="mt-1 text-[22px] font-semibold">${(revenue.verifiedCents / 100).toFixed(2)}</p>
          <p className="mt-1 text-[11px] text-ink-3">
            {revenue.verifiedOrders} verified PayPal {revenue.verifiedOrders === 1 ? "order" : "orders"}
            {revenue.refundedCents > 0
              ? ` · $${(revenue.refundedCents / 100).toFixed(2)} removed by deletions`
              : " · deleted ads are not counted"}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-pcard p-4">
          <h2 className="text-[13px] font-semibold">Recent Videos</h2>
          {(recentVideos || []).length === 0 ? <p className="mt-4 text-[12px] text-ink-3">No videos published yet</p> : (
            <div className="mt-3 space-y-2">{(recentVideos || []).map((video: any) => <div key={video.id} className="flex items-center justify-between gap-3 rounded-md border border-line/50 bg-void px-3 py-2"><span className="truncate text-[12px]">{video.title}</span><span className="shrink-0 text-[10px] uppercase text-ink-3">{video.status}</span></div>)}</div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-pcard p-4">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">Latest ad submissions</h2><Link href="/admin/advertisements" className="text-[11px] text-accent">Review all</Link></div>
          {(recentOrders || []).length === 0 ? <p className="mt-4 text-[12px] text-ink-3">No guest ad submissions yet</p> : (
            <div className="mt-3 space-y-2">{(recentOrders || []).map((order: any) => (
              <Link href="/admin/advertisements" key={order.id} className="block rounded-md border border-line/50 bg-void px-3 py-2 transition hover:border-accent/30">
                <div className="flex items-center justify-between gap-3"><p className="truncate text-[12px] font-medium">{order.ad_name}</p><span className="shrink-0 text-[10px] uppercase text-accent">{order.status.replaceAll("_", " ")}</span></div>
                <p className="mt-1 text-[10.5px] text-ink-3">PayPal {order.payment_status} · {new Date(order.created_at).toLocaleDateString()}</p>
              </Link>
            ))}</div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold">Ad Slots Overview</h2>
          <Link href="/admin/ad-slots" className="text-[11px] text-accent">Open ad slots</Link>
        </div>
        {slots.length === 0 ? (
          <p className="mt-3 text-[12px] text-ink-3">Slot inventory could not be read. Apply the latest database migration.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            {slots.map((slot) => (
              <div key={slot.id} className="rounded-md border border-line bg-void p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium">Slot {slot.id}</p>
                  <span
                    className={`rounded-full px-1.5 py-[1px] text-[8.5px] font-semibold uppercase tracking-wider ${
                      slot.taken
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-zinc-500/15 text-ink-3"
                    }`}
                  >
                    {slot.label}
                  </span>
                </div>
                <p className="mt-1 truncate text-[10px] text-ink-3">{slot.name}</p>
                <p className={`mt-1 truncate text-[10px] ${slot.taken ? "text-emerald-400" : "text-ink-3"}`}>
                  {slot.taken ? slot.ad?.ad_name || "Reserved" : "Ready to sell"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
