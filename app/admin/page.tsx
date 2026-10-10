import { createServiceClient } from "@/lib/supabase/server";

export default async function AdminDashboard() {
  const supabase = createServiceClient();

  const [{ count: videoCount }, { count: publishedCount }, { data: recentVideos }, { data: slots }, { data: reports }, { count: advertiserCount }] = await Promise.all([
    supabase.from("videos").select("*", { count: "exact", head: true }),
    supabase.from("videos").select("*", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("videos").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("ad_slots").select("*").order("id"),
    supabase.from("reports").select("*", { count: "exact", head: false }).eq("status", "new").limit(5),
    supabase.from("advertiser_profiles").select("*", { count: "exact", head: true }),
  ]);

  const { data: revenue } = await supabase.from("payments").select("amount_cents").eq("status", "confirmed");

  const totalRevenue = (revenue || []).reduce((sum: number, p: any) => sum + p.amount_cents, 0);

  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">Real data from database</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-pcard p-4">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Total Videos</p>
          <p className="mt-1 text-[22px] font-semibold">{videoCount || 0}</p>
          <p className="mt-1 text-[11px] text-ink-3">{publishedCount || 0} published</p>
        </div>
        <div className="rounded-lg border border-line bg-pcard p-4">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Ad Slots</p>
          <p className="mt-1 text-[22px] font-semibold">{slots?.length || 0}/10</p>
          <p className="mt-1 text-[11px] text-ink-3">Fixed inventory</p>
        </div>
        <div className="rounded-lg border border-line bg-pcard p-4">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Advertisers</p>
          <p className="mt-1 text-[22px] font-semibold">{advertiserCount || 0}</p>
          <p className="mt-1 text-[11px] text-ink-3">Active accounts</p>
        </div>
        <div className="rounded-lg border border-line bg-pcard p-4">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Revenue (confirmed)</p>
          <p className="mt-1 text-[22px] font-semibold">${(totalRevenue / 100).toFixed(2)}</p>
          <p className="mt-1 text-[11px] text-ink-3">From verified payments only</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-pcard p-4">
          <h2 className="text-[13px] font-semibold">Recent Videos</h2>
          {(recentVideos || []).length === 0 ? (
            <p className="mt-4 text-[12px] text-ink-3">No videos published yet</p>
          ) : (
            <div className="mt-3 space-y-2">
              {(recentVideos || []).map((v: any) => (
                <div key={v.id} className="flex items-center justify-between rounded-md border border-line/50 bg-void px-3 py-2">
                  <span className="text-[12px]">{v.title}</span>
                  <span className="text-[10px] uppercase text-ink-3">{v.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-pcard p-4">
          <h2 className="text-[13px] font-semibold">Reports awaiting review</h2>
          {(reports || []).length === 0 ? (
            <p className="mt-4 text-[12px] text-ink-3">No reports awaiting review</p>
          ) : (
            <div className="mt-3 space-y-2">
              {(reports || []).map((r: any) => (
                <div key={r.id} className="rounded-md border border-line/50 bg-void px-3 py-2">
                  <p className="text-[12px] font-medium">{r.type} — {r.reason}</p>
                  <p className="mt-1 text-[11px] text-ink-3">{r.content_id}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-pcard p-4">
        <h2 className="text-[13px] font-semibold">Ad Slots Overview</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          {(slots || []).map((s: any) => (
            <div key={s.id} className="rounded-md border border-line bg-void p-3">
              <p className="text-[11px] font-medium">Slot {s.id}</p>
              <p className="text-[10px] text-ink-3">{s.name}</p>
              <p className="mt-1 text-[10px] uppercase text-accent">{s.status}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
