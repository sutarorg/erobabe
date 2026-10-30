import AnalyticsTabs from "@/src/components/analytics/AnalyticsTabs";

export const metadata = { title: "Analytics" };

/**
 * Shared chrome for every analytics report.
 *
 * Authorisation is enforced by the admin layout above this one (active admin
 * session, role checked against `profiles`), and again by middleware; the tabs
 * below only navigate between reports.
 */
export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 max-w-[720px] text-[12.5px] leading-relaxed text-ink-3">
            First-party measurement of traffic, audience and advertising — UTC, pseudonymous, no
            third-party trackers and no fabricated estimates.
          </p>
        </div>
        <span className="rounded-full border border-line bg-pcard px-2 py-1 text-[10px] uppercase tracking-wider text-ink-3">
          Staff only
        </span>
      </div>
      <div className="mt-4">
        <AnalyticsTabs />
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
