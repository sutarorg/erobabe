import PaymentRefresh from "@/src/components/PaymentRefresh";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export default async function PaymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const service = createServiceClient();
  const { data: payments } = await service
    .from("payments")
    .select("*")
    .eq("advertiser_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-[20px] font-semibold">Payments</h1>
      <p className="mt-1 text-[12px] text-ink-3">
        Real payment history — no fake wallet, no invented balances
      </p>

      {(payments || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center">
          <p className="text-[14px]">No payments recorded</p>
        </div>
      ) : (
        <div className="mt-6 center-scroll overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {(payments || []).map((p: any) => (
                <tr key={p.id} className="border-b border-line/50">
                  <td className="px-4 py-3 font-mono text-[11px]">
                    {p.invoice_number}
                    <details className="mt-2 max-w-xs">
                      <summary className="cursor-pointer text-accent">
                        Payment details
                      </summary>
                      <p className="mt-2 break-all">Reference: {p.id}</p>
                      {p.payment_address &&
                      ["awaiting_confirmation", "partially_confirmed"].includes(
                        p.status,
                      ) &&
                      new Date(p.expires_at).getTime() > Date.now() ? (
                        <>
                          <p className="mt-2 break-all">
                            Address: {p.payment_address}
                          </p>
                          <p>
                            Expected: {p.expected_amount} {p.pay_currency}
                          </p>
                          <p>Expires: {p.expires_at}</p>
                        </>
                      ) : (
                        <p className="mt-2">
                          Do not send funds to expired or unresolved payment
                          requests. Contact support with this reference for
                          recovery.
                        </p>
                      )}
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    ${(p.amount_cents / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    {p.pay_currency || p.payment_currency} / {p.chain}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">
                      {p.status}
                    </span>
                    <PaymentRefresh id={p.id} />
                  </td>
                  <td className="px-4 py-3 text-ink-3">
                    {new Date(p.created_at).toLocaleDateString()}
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
