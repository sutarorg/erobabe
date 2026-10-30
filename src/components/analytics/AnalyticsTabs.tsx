"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/src/utils/cn";

const TABS = [
  { href: "/admin/analytics", label: "Overview" },
  { href: "/admin/analytics/traffic", label: "Traffic" },
  { href: "/admin/analytics/audience", label: "Audience" },
  { href: "/admin/analytics/engagement", label: "Engagement" },
  { href: "/admin/analytics/advertising", label: "Advertising" },
];

/**
 * Section navigation for the analytics report.
 *
 * A tab stays highlighted on its drill-down pages (`/traffic/pages/...`,
 * `/advertising/<id>`), so an operator always knows which report they are in.
 */
export function activeTab(pathname: string | null): string {
  const path = String(pathname || "");
  return (
    [...TABS]
      .sort((a, b) => b.href.length - a.href.length)
      .find((tab) => path === tab.href || path.startsWith(`${tab.href}/`))?.href ?? "/admin/analytics"
  );
}

export default function AnalyticsTabs() {
  const pathname = usePathname();
  const active = activeTab(pathname);
  return (
    <nav aria-label="Analytics sections" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={active === tab.href ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
            active === tab.href
              ? "bg-white/8 text-ink"
              : "text-ink-3 hover:bg-white/5 hover:text-ink-2",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
