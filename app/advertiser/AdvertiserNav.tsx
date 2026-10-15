"use client";
import {
  BarChart3,
  CircleHelp,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  Radio,
} from "lucide-react";
import DashboardNav from "@/src/components/DashboardNav";
const items = [
  { href: "/advertiser", label: "Overview", icon: LayoutDashboard },
  { href: "/advertiser/slots", label: "Book Ad Space", icon: Megaphone },
  { href: "/advertiser/campaigns", label: "My Campaigns", icon: Radio },
  { href: "/advertiser/analytics", label: "Analytics", icon: BarChart3 },
  {
    href: "/advertiser/billing",
    label: "Billing",
    icon: CreditCard,
    aliases: ["/advertiser/payments", "/advertiser/invoices"],
  },
  { href: "/advertiser/support", label: "Help & Support", icon: CircleHelp },
];
export default function AdvertiserNav() {
  return <DashboardNav label="Advertiser navigation" items={items} />;
}
