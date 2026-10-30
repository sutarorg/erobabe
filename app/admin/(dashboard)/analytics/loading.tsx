export default function AnalyticsLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading analytics…</span>
      <div className="h-4 w-32 rounded bg-white/10" />
      <div className="mt-3 h-7 w-72 rounded bg-white/5" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-[86px] rounded-lg border border-line bg-pcard" />
        ))}
      </div>
      <div className="mt-4 h-[260px] rounded-lg border border-line bg-pcard" />
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="h-[220px] rounded-lg border border-line bg-pcard" />
        <div className="h-[220px] rounded-lg border border-line bg-pcard" />
      </div>
    </div>
  );
}
