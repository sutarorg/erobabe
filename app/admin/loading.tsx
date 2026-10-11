export default function AdminLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-40 rounded bg-white/10" />
      <div className="mt-2 h-3 w-64 rounded bg-white/5" />
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-24 rounded-lg border border-line bg-pcard" />
        ))}
      </div>
    </div>
  );
}
