"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/src/utils/cn";
export type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  aliases?: string[];
};
export type NavItem =
  | NavLink
  | { label: string; icon: LucideIcon; children: NavLink[] };
export function activeHref(path: string, items: NavLink[]) {
  return items
    .filter((i) =>
      [i.href, ...(i.aliases || [])].some(
        (h) =>
          path === h ||
          (h !== "/admin" && path.startsWith(`${h}/`)),
      ),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
export default function DashboardNav({
  items,
  label,
}: {
  items: NavItem[];
  label: string;
}) {
  const path = usePathname();
  const active = activeHref(
    path,
    items.flatMap((i) => ("children" in i ? i.children : [i])),
  );
  const group = items.find(
    (i) => "children" in i && i.children.some((c) => c.href === active),
  )?.label;
  const [expanded, setExpanded] = useState<string[]>(group ? [group] : []);
  useEffect(() => {
    if (group) setExpanded((v) => (v.includes(group) ? v : [...v, group]));
  }, [group]);
  function link(item: NavLink) {
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active === item.href ? "page" : undefined}
        className={cn(
          "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-[12.5px] font-medium outline-offset-2 focus-visible:outline focus-visible:outline-accent",
          active === item.href
            ? "bg-white/8 text-ink"
            : "text-ink-2 hover:bg-white/5",
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0",
            active === item.href ? "text-accent" : "text-ink-3",
          )}
          strokeWidth={1.8}
        />
        {item.label}
      </Link>
    );
  }
  return (
    <nav aria-label={label} className="no-scrollbar flex-1 overflow-y-auto p-3">
      <div className="space-y-1">
        {items.map((item) => {
          if (!("children" in item)) return link(item);
          const open = expanded.includes(item.label);
          const Icon = item.icon;
          return (
            <div key={item.label}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`nav-${item.label}`}
                onClick={() =>
                  setExpanded((v) =>
                    open
                      ? v.filter((g) => g !== item.label)
                      : [...v, item.label],
                  )
                }
                className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[12.5px] text-ink-2 hover:bg-white/5 focus-visible:outline-accent"
              >
                <Icon aria-hidden className="h-4 w-4 text-ink-3" />
                {item.label}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "ml-auto h-3.5 w-3.5 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
              <div
                id={`nav-${item.label}`}
                hidden={!open}
                className="ml-3 border-l border-line pl-2"
              >
                {item.children.map(link)}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
