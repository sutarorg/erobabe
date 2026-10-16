import { createServiceClient } from "@/lib/supabase/server";

export default async function AdvertisersAdmin() {
  const supabase = createServiceClient();
  const { data: advertisers } = await supabase.from("advertiser_profiles").select("id, company_name, contact_name, status, created_at").order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Advertisers</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real advertiser profiles from database</p>

      {(advertisers || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px]">No advertisers yet</p>
        </div>
      ) : (
        <div className="mt-6 center-scroll overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3">
              <tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Registered</th></tr>
            </thead>
            <tbody>
              {(advertisers || []).map((a: any) => (
                <tr key={a.id} className="border-b border-line/50">
                  <td className="px-4 py-3 font-medium">{a.company_name}</td>
                  <td className="px-4 py-3">{a.contact_name || "—"}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">{a.status}</span></td>
                  <td className="px-4 py-3 text-ink-3">{new Date(a.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
