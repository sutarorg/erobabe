import { redirect } from "next/navigation";
export default function LegacyBilling() {
  redirect("/advertiser/billing?tab=invoices");
}
