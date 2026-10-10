import { ArrowDownLeft, ArrowUpRight, CreditCard, Download, Plus } from "lucide-react";
import { cn } from "../utils/cn";
import { fmtUSD, type Invoice, type Transaction } from "./data";
import { Btn, Card, PageHeader } from "./ui";

/* ----------------------------- Payments ---------------------------- */

export function PaymentsView({
  wallet,
  transactions,
  onAddFunds,
}: {
  wallet: number;
  transactions: Transaction[];
  onAddFunds: () => void;
}) {
  return (
    <div>
      <PageHeader title="Payments" sub="Your wallet activity and payment history." />

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1fr_1.9fr]">
        <div className="space-y-5">
          <Card className="p-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Wallet Balance</p>
            <p className="mt-2 text-[28px] font-semibold tabular-nums tracking-tight text-ink">
              {fmtUSD(wallet)}
            </p>
            <div className="mt-4 flex gap-2">
              <Btn className="flex-1" onClick={onAddFunds}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add Funds
              </Btn>
              <Btn variant="outline" className="flex-1" disabled title="Withdrawals are disabled in this demo">
                Withdraw
              </Btn>
            </div>
            <p className="mt-3 text-[10.5px] leading-relaxed text-ink-3">
              Demo wallet — balances exist only in local state.
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="text-[13px] font-semibold text-ink">Payment methods</h3>
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-pcard px-3.5 py-3">
              <CreditCard className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink">Visa •••• 4242</p>
                <p className="text-[10.5px] text-ink-3">Expires 09 / 2028</p>
              </div>
              <span className="rounded-full border border-accent/45 bg-accent/8 px-2 py-0.5 text-[9.5px] font-semibold text-accent">
                Default
              </span>
            </div>
            <Btn variant="outline" className="mt-3 w-full" onClick={onAddFunds}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add payment method
            </Btn>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <h3 className="border-b border-line px-4 py-3.5 text-[13px] font-semibold text-ink">
            Payment history
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-line">
                  {["Date", "Description", "Type", "Method", "Amount", "Status"].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-4 py-3 text-[11.5px] tabular-nums text-ink-3">{tx.date}</td>
                    <td className="px-4 py-3 text-[12px] text-ink-2">{tx.desc}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          tx.type === "topup"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-line bg-white/[0.03] text-ink-3"
                        )}
                      >
                        {tx.type === "topup" ? (
                          <ArrowDownLeft className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowUpRight className="h-3 w-3" aria-hidden />
                        )}
                        {tx.type === "topup" ? "Top-up" : "Payment"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-ink-3">{tx.method}</td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-4 py-3 text-[12px] font-semibold tabular-nums",
                        tx.amount > 0 ? "text-emerald-400" : "text-ink"
                      )}
                    >
                      {tx.amount > 0 ? "+" : "−"}{fmtUSD(Math.abs(tx.amount))}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-medium text-emerald-400">{tx.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------- Invoices ---------------------------- */

function downloadInvoice(inv: Invoice) {
  const body = [
    "EROBABE — DEMO INVOICE",
    "================================================",
    `Invoice ID : ${inv.id}`,
    `Date       : ${inv.date}`,
    `Description: ${inv.desc}`,
    `Amount     : ${fmtUSD(inv.amount)}`,
    `Status     : ${inv.status}`,
    "================================================",
    "Billed to  : EroAds Media (ads@eroads.media)",
    "",
    "This is a frontend demo document. No real payment",
    "was processed and no real invoice exists.",
  ].join("\n");
  const blob = new Blob([body], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${inv.id}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function InvoicesView({ invoices }: { invoices: Invoice[] }) {
  return (
    <div>
      <PageHeader title="Invoices" sub="Download receipts for reservations and wallet top-ups." />

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["Invoice", "Date", "Description", "Amount", "Status", ""].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {invoices.map((inv) => (
                <tr key={inv.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-[12px] font-semibold text-ink">{inv.id}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[11.5px] tabular-nums text-ink-3">{inv.date}</td>
                  <td className="px-4 py-3 text-[12px] text-ink-2">{inv.desc}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[12px] font-semibold tabular-nums text-ink">
                    {fmtUSD(inv.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => downloadInvoice(inv)}
                      aria-label={`Download ${inv.id}`}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-zinc-500 hover:text-ink"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-[11px] text-ink-3">
        Downloads are generated locally as demo text files — nothing is sent to a server.
      </p>
    </div>
  );
}
