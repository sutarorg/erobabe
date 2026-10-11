"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/src/utils/cn";

export default function DashboardNav({
  items,
  label,
}: {
  items: { href: string; label: string; icon: LucideIcon }[];
  label: string;
}) {
  const pathname = usePathname();
  const match = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <nav aria-label={label} className="no-scrollbar flex-1 overflow-y-auto p-3">
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = match?.href === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-[12.5px] font-medium transition-colors",
                active ? "bg-white/8 text-ink" : "text-ink-2 hover:bg-white/5 hover:text-ink"
              )}
            >
              <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-ink-3")} strokeWidth={1.8} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
