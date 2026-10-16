import { createServiceClient } from "@/lib/supabase/server";

export default async function LogsAdmin() {
  const supabase = createServiceClient();
  const { data: logs } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Audit Logs</h1>
      <p className="mt-1 text-[12px] text-ink-3">Privileged actions — publishing, roles, approvals, payments, settings</p>

      {(logs || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center"><p className="text-[13px]">No audit history yet</p></div>
      ) : (
        <div className="mt-6 center-scroll overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Level</th></tr></thead>
            <tbody>
              {(logs || []).map((l: any) => (
                <tr key={l.id} className="border-b border-line/50"><td className="px-4 py-3 text-[11px] text-ink-3">{new Date(l.created_at).toLocaleString()}</td><td className="px-4 py-3 font-medium">{l.action}</td><td className="px-4 py-3 text-ink-3">{l.target_type} {l.target_id?.slice(0, 8)}</td><td className="px-4 py-3 uppercase text-[10px]">{l.level}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
