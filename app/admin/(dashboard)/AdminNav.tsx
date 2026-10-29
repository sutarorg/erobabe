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
  ScrollText,
  Settings,
  Tag,
} from "lucide-react";
import DashboardNav from "@/src/components/DashboardNav";

/**
 * Staff-only navigation.
 *
 * There are no public accounts and no advertiser portal: the dashboard is the
 * only signed-in surface, so user management and legacy campaign pages are gone.
 */
const items = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  {
    label: "Content",
    icon: Clapperboard,
    children: [
      { href: "/admin/videos", label: "Videos", icon: Film },
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
        label: "Ad Review",
        icon: Megaphone,
      },
    ],
  },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/reports", label: "Reports", icon: Flag },
  {
    label: "Management",
    icon: Settings,
    children: [
      { href: "/admin/logs", label: "Activity Logs", icon: ScrollText },
      { href: "/admin/system-health", label: "System Health", icon: Activity },
    ],
  },
];
export default function AdminNav() {
  return <DashboardNav label="Admin navigation" items={items} />;
}
