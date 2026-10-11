export default function AdvertiserLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-40 rounded bg-white/10" />
      <div className="mt-2 h-3 w-56 rounded bg-white/5" />
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 rounded-lg border border-line bg-pcard" />
        ))}
      </div>
    </div>
  );
}