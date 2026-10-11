"use client";

import {
  BarChart3,
  CircleHelp,
  CreditCard,
  FileText,
  LayoutDashboard,
  Megaphone,
  PlusCircle,
  Radio,
  UserRound,
} from "lucide-react";
import DashboardNav from "@/src/components/DashboardNav";

const items = [
  { href: "/advertiser", label: "Dashboard", icon: LayoutDashboard },
  { href: "/advertiser/slots", label: "Ad Slots", icon: Megaphone },
  { href: "/advertiser/campaigns", label: "My Campaigns", icon: Radio },
  { href: "/advertiser/campaigns/new", label: "New Campaign", icon: PlusCircle },
  { href: "/advertiser/payments", label: "Payments", icon: CreditCard },
  { href: "/advertiser/invoices", label: "Invoices", icon: FileText },
  { href: "/advertiser/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/advertiser/profile", label: "Profile", icon: UserRound },
  { href: "/advertiser/support", label: "Support", icon: CircleHelp },
];

export default function AdvertiserNav() {
  return <DashboardNav label="Advertiser navigation" items={items} />;
}
