import { createClient, createServiceClient } from "@/lib/supabase/server";

export default async function InvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const service = createServiceClient();
  const { data: invoices } = await service
    .from("invoices")
    .select("*")
    .eq("advertiser_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Invoices</h1>
      <p className="mt-1 text-[12px] text-ink-3">
        Real invoice records — immutable, auditable
      </p>
      {(invoices || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p>No invoices yet</p>
        </div>
      ) : (
        <div className="mt-6 center-scroll overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {(invoices || []).map((inv: any) => (
                <tr key={inv.id} className="border-b border-line/50">
                  <td className="px-4 py-3 font-mono text-[11px]">
                    {inv.number}
                  </td>
                  <td className="px-4 py-3">{inv.description}</td>
                  <td className="px-4 py-3">
                    ${(inv.amount_cents / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 uppercase text-[10px]">
                    {inv.status}
                  </td>
                  <td className="px-4 py-3 text-ink-3">
                    {new Date(inv.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
