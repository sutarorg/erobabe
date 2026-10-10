import { createServiceClient } from "@/lib/supabase/server";

export default async function PaymentsAdmin() {
  const supabase = createServiceClient();
  const { data: payments } = await supabase.from("payments").select("id, external_id, amount_cents, payment_currency, chain, status, created_at, advertiser_id").order("created_at", { ascending: false }).limit(100);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Payments</h1>
      <p className="mt-1 text-[12px] text-ink-3">Real Bcon payments — confirmed only after blockchain verification. No fake balances.</p>

      {(payments || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px]">No payments recorded</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3">
              <tr><th className="px-4 py-3">External ID</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Currency/Chain</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th></tr>
            </thead>
            <tbody>
              {(payments || []).map((p: any) => (
                <tr key={p.id} className="border-b border-line/50">
                  <td className="px-4 py-3 font-mono text-[11px]">{p.external_id}</td>
                  <td className="px-4 py-3">${(p.amount_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">{p.payment_currency} / {p.chain}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">{p.status}</span></td>
                  <td className="px-4 py-3 text-ink-3">{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
