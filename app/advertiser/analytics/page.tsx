import { createClient, createServiceClient } from "@/lib/supabase/server";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const service = createServiceClient();
  const { data: campaigns } = await service.from("campaigns").select("id, name, impressions, clicks, slot_id").eq("advertiser_id", user.id);

  const totalImpr = (campaigns || []).reduce((s: number, c: any) => s + (c.impressions || 0), 0);
  const totalClicks = (campaigns || []).reduce((s: number, c: any) => s + (c.clicks || 0), 0);
  const ctr = totalImpr > 0 ? ((totalClicks / totalImpr) * 100).toFixed(2) : "0";

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Analytics</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real measured data — no hardcoded metrics. If unavailable, shows unavailable.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[11px] uppercase text-ink-3">Impressions</p><p className="mt-1 text-[22px] font-semibold">{totalImpr || "0"}</p></div>
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[11px] uppercase text-ink-3">Clicks</p><p className="mt-1 text-[22px] font-semibold">{totalClicks || "0"}</p></div>
        <div className="rounded-lg border border-line bg-pcard p-4"><p className="text-[11px] uppercase text-ink-3">CTR</p><p className="mt-1 text-[22px] font-semibold">{ctr}%</p></div>
      </div>

      {(campaigns || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center"><p className="text-[13px]">No performance data available yet</p><p className="mt-1 text-[11px] text-ink-3">Analytics will appear as campaigns deliver impressions.</p></div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]"><thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3"><tr><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Slot</th><th className="px-4 py-3">Impressions</th><th className="px-4 py-3">Clicks</th><th className="px-4 py-3">CTR</th></tr></thead>
            <tbody>{(campaigns || []).map((c: any) => <tr key={c.id} className="border-b border-line/50"><td className="px-4 py-3">{c.name}</td><td className="px-4 py-3">Slot {c.slot_id}</td><td className="px-4 py-3">{c.impressions}</td><td className="px-4 py-3">{c.clicks}</td><td className="px-4 py-3">{c.impressions ? ((c.clicks / c.impressions) * 100).toFixed(2) : "0"}%</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
