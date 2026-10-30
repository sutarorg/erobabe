import Link from "next/link";

export default function AnalyticsNotFound() {
  return (
    <div className="rounded-lg border border-line bg-pcard p-6 text-center">
      <p className="text-[13px] font-semibold">That report does not exist</p>
      <p className="mx-auto mt-1 max-w-[480px] text-[12px] leading-relaxed text-ink-3">
        The advertisement may have been deleted (an ad&apos;s performance is removed with it), or the
        path was typed incorrectly.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Link href="/admin/analytics" className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white">
          Analytics overview
        </Link>
        <Link href="/admin/analytics/advertising" className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-2">
          Advertising report
        </Link>
      </div>
    </div>
  );
}
