import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";

export default async function PaymentsAdmin() {
  const supabase = createServiceClient();
  const { data: payments, error } = await supabase
    .from("ad_orders")
    .select("id, ad_name, email, amount_cents, currency, paypal_transaction_id, payment_status, payment_verified_at, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="text-[20px] font-semibold">PayPal payments</h1>
      <p className="mt-1 text-[12px] text-ink-3">Manual payment verification for guest advertising orders. Check PayPal itself before confirming any payment.</p>

      {error && <p role="alert" className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-[12px] text-red-300">Unable to load PayPal order records. Apply the latest database migration and try again.</p>}

      {!error && (payments || []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-pcard p-12 text-center"><p className="text-[14px]">No PayPal orders recorded</p></div>
      ) : (
        <div className="mt-6 center-scroll overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[900px] text-left text-[12px]">
            <thead className="border-b border-line bg-pcard text-[11px] uppercase text-ink-3">
              <tr><th className="px-4 py-3">Ad / advertiser</th><th className="px-4 py-3">PayPal transaction</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Ad status</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {(payments || []).map((payment: any) => (
                <tr key={payment.id} className="border-b border-line/50">
                  <td className="px-4 py-3"><p className="font-medium">{payment.ad_name}</p><p className="mt-1 text-[10.5px] text-ink-3">{payment.email}</p></td>
                  <td className="max-w-[210px] break-all px-4 py-3 font-mono text-[10.5px] text-ink-2">{payment.paypal_transaction_id || "Not supplied"}</td>
                  <td className="px-4 py-3">${(payment.amount_cents / 100).toFixed(2)} {payment.currency}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] uppercase ${payment.payment_status === "verified" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>{payment.payment_status}</span>{payment.payment_verified_at && <p className="mt-1 text-[10px] text-ink-3">{new Date(payment.payment_verified_at).toLocaleString()}</p>}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase">{payment.status.replaceAll("_", " ")}</span></td>
                  <td className="px-4 py-3 text-ink-3">{new Date(payment.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><Link href="/admin/advertisements" className="text-accent hover:underline">Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
