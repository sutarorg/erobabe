"use client";
import {
  Activity,
  Clapperboard,
  CreditCard,
  Film,
  Flag,
  LayoutDashboard,
  Megaphone,
  PanelsTopLeft,
  Radio,
  ScrollText,
  Settings,
  Tag,
  UploadCloud,
  Users,
  UsersRound,
} from "lucide-react";
import DashboardNav from "@/src/components/DashboardNav";
const items = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  {
    label: "Content",
    icon: Clapperboard,
    children: [
      { href: "/admin/videos", label: "Videos", icon: Film },
      {
        href: "/admin/videos/upload",
        label: "Upload Videos",
        icon: UploadCloud,
      },
      { href: "/admin/categories", label: "Categories", icon: Tag },
    ],
  },
  {
    label: "Advertising",
    icon: Megaphone,
    children: [
      { href: "/admin/ad-slots", label: "Ad Slots", icon: PanelsTopLeft },
      {
        href: "/admin/advertisements",
        label: "Ads & Creatives",
        icon: Megaphone,
      },
      { href: "/admin/campaigns", label: "Campaigns", icon: Radio },
      { href: "/admin/advertisers", label: "Advertisers", icon: UsersRound },
    ],
  },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/reports", label: "Reports", icon: Flag },
  {
    label: "Management",
    icon: Settings,
    children: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/logs", label: "Activity Logs", icon: ScrollText },
      { href: "/admin/system-health", label: "System Health", icon: Activity },
    ],
  },
];
export default function AdminNav() {
  return <DashboardNav label="Admin navigation" items={items} />;
}
