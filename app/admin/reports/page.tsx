import { createServiceClient } from "@/lib/supabase/server";

export default async function ReportsAdmin() {
  const supabase = createServiceClient();
  const { data: reports } = await supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(100);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Reports & Removal Requests</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real persistent records — reports never silently disappear</p>

      {(reports || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px]">No reports awaiting review</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {(reports || []).map((r: any) => (
            <div key={r.id} className="rounded-lg border border-line bg-pcard p-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-medium">{r.type} — {r.reason}</p>
                <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">{r.status}</span>
              </div>
              <p className="mt-2 text-[11px] text-ink-3">{r.content_id}</p>
              <p className="mt-1 text-[11px] text-ink-3">{r.details}</p>
              <p className="mt-2 text-[10px] text-ink-3">Reported by {r.email} on {new Date(r.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
