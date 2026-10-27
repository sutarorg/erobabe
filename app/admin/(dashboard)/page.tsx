import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";

export default async function AdminDashboard() {
  const supabase = createServiceClient();

  const [
    { count: videoCount },
    { count: publishedCount },
    { data: recentVideos },
    { data: slots },
    { count: reviewCount },
    { data: recentOrders },
    { data: verifiedOrders },
  ] = await Promise.all([
    supabase.from("videos").select("*", { count: "exact", head: true }),
    supabase.from("videos").select("*", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("videos").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("ad_slots").select("*").order("id"),
    supabase.from("ad_orders").select("*", { count: "exact", head: true }).eq("status", "in_review"),
    supabase.from("ad_orders").select("id, ad_name, status, payment_status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("ad_orders").select("amount_cents").eq("payment_status", "verified"),
  ]);

  const totalRevenue = (verifiedOrders || []).reduce((sum: number, order: any) => sum + order.amount_cents, 0);

  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">Live content and guest advertising orders</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[11px] uppercase tracking-wider text-ink-3">Total Videos</p><p className="mt-1 text-[22px] font-semibold">{videoCount || 0}</p><p className="mt-1 text-[11px] text-ink-3">{publishedCount || 0} published</p></div>
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[11px] uppercase tracking-wider text-ink-3">Ad Slots</p><p className="mt-1 text-[22px] font-semibold">{slots?.length || 0}/10</p><p className="mt-1 text-[11px] text-ink-3">Fixed inventory</p></div>
        <Link href="/admin/advertisements" className="rounded-lg border border-line bg-pcard p-4 transition hover:border-accent/40"><p className="text-[11px] uppercase tracking-wider text-ink-3">Ads In Review</p><p className="mt-1 text-[22px] font-semibold">{reviewCount || 0}</p><p className="mt-1 text-[11px] text-accent">Review payments & creatives</p></Link>
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[11px] uppercase tracking-wider text-ink-3">Verified Ad Revenue</p><p className="mt-1 text-[22px] font-semibold">${(totalRevenue / 100).toFixed(2)}</p><p className="mt-1 text-[11px] text-ink-3">Manually confirmed PayPal orders</p></div>
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
        <h2 className="text-[13px] font-semibold">Ad Slots Overview</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">{(slots || []).map((slot: any) => <div key={slot.id} className="rounded-md border border-line bg-void p-3"><p className="text-[11px] font-medium">Slot {slot.id}</p><p className="text-[10px] text-ink-3">{slot.name}</p><p className="mt-1 text-[10px] uppercase text-accent">{slot.status}</p></div>)}</div>
      </div>
    </div>
  );
}
