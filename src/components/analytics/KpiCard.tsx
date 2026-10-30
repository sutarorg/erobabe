import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatPercent } from "@/lib/analytics/metrics";
import { cn } from "@/src/utils/cn";

/**
 * One KPI. `delta` is the fractional change against the previous window; a
 * null delta means "no previous data to compare with", which is shown as such
 * rather than as a fake 0%.
 */
export default function KpiCard({
  label,
  value,
  hint,
  delta,
  comparedTo,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  comparedTo?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wider text-ink-3">{label}</p>
      <p className="mt-1 text-[22px] font-semibold leading-none tabular-nums">{value}</p>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px]">
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              delta === null
                ? "text-ink-3"
                : delta > 0
                  ? "text-emerald-400"
                  : delta < 0
                    ? "text-red-400"
                    : "text-ink-3",
            )}
          >
            {delta === null ? (
              <Minus aria-hidden className="h-3 w-3" />
            ) : delta > 0 ? (
              <ArrowUpRight aria-hidden className="h-3 w-3" />
            ) : delta < 0 ? (
              <ArrowDownRight aria-hidden className="h-3 w-3" />
            ) : (
              <Minus aria-hidden className="h-3 w-3" />
            )}
            {delta === null ? "no prior data" : formatPercent(Math.abs(delta), 1)}
          </span>
        )}
        {(delta !== undefined || hint) && (
          <span className="text-ink-3">{hint || comparedTo}</span>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-lg border border-line bg-pcard p-4 transition hover:border-accent/40"
      >
        {body}
      </Link>
    );
  }

  return <div className="rounded-lg border border-line bg-pcard p-4">{body}</div>;
}
