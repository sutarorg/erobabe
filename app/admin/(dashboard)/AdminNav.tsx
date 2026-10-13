"use client";

import {
  Activity,
  BadgeDollarSign,
  Clapperboard,
  CreditCard,
  Film,
  Flag,
  LayoutDashboard,
  Megaphone,
  PanelsTopLeft,
  Radio,
  ScrollText,
  Tag,
  UploadCloud,
  Users,
  UsersRound,
} from "lucide-react";
import DashboardNav from "@/src/components/DashboardNav";

const items = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/videos", label: "Videos", icon: Film },
  { href: "/admin/videos/upload", label: "Upload", icon: UploadCloud },
  { href: "/admin/categories", label: "Categories", icon: Tag },
  { href: "/admin/advertisements", label: "Advertisements", icon: Megaphone },
  { href: "/admin/ad-slots", label: "Ad Slots", icon: PanelsTopLeft },
  { href: "/admin/advertisers", label: "Advertisers", icon: UsersRound },
  { href: "/admin/campaigns", label: "Campaigns", icon: Radio },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/reports", label: "Reports", icon: Flag },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/logs", label: "Logs", icon: ScrollText },
  { href: "/admin/system-health", label: "System Health", icon: Activity },
];

export default function AdminNav() {
  return <DashboardNav label="Admin navigation" items={items} />;
}
