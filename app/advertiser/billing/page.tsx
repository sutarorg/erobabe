import Link from "next/link";
import Payments from "./Payments";
import Invoices from "./Invoices";
export default async function Billing({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const invoices = (await searchParams).tab === "invoices";
  return (
    <>
      <h1 className="text-xl font-semibold">Billing</h1>
      <nav aria-label="Billing sections" className="my-5 flex gap-2">
        {[
          ["payments", "Payments"],
          ["invoices", "Invoices"],
        ].map(([tab, label]) => (
          <Link
            key={tab}
            href={`/advertiser/billing?tab=${tab}`}
            aria-current={
              (tab === "invoices") === invoices ? "page" : undefined
            }
            className={`rounded border border-line px-4 py-2 text-sm ${(tab === "invoices") === invoices ? "bg-white/10" : "text-ink-3"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {invoices ? <Invoices /> : <Payments />}
    </>
  );
}
