import { Download } from "lucide-react";
import type { AnalyticsRange } from "@/lib/analytics/range";
import RangePicker from "./RangePicker";

/**
 * Title, range control and CSV export for one report page.
 *
 * The export link points at the admin-only CSV route with exactly the range the
 * page is showing, so what downloads is what is on screen.
 */
export default function AnalyticsHeader({
  title,
  subtitle,
  range,
  exportHref,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  range: AnalyticsRange;
  exportHref: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-ink-3">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-pcard px-2.5 py-1.5 text-[11.5px] font-medium text-ink-2 transition hover:border-accent/40 hover:text-ink"
          >
            <Download aria-hidden className="h-3.5 w-3.5" />
            Export CSV
          </a>
        </div>
      </div>
      <RangePicker range={range} />
    </div>
  );
}
