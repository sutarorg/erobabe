import type { ReactNode } from "react";
import { cn } from "@/src/utils/cn";

/** The card every analytics section sits in. Matches the admin dashboard. */
export default function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-line bg-pcard p-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11px] text-ink-3">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className={cn("mt-3", bodyClassName)}>{children}</div>
    </section>
  );
}
