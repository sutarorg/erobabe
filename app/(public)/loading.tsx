export default function PublicLoading() {
  return (
    <div className="animate-pulse pt-6">
      <div className="h-6 w-48 rounded bg-white/10" />
      <div className="mt-2 h-3 w-32 rounded bg-white/5" />
      <div className="mt-6 grid grid-cols-2 gap-4 @md:grid-cols-3 @lg:grid-cols-4">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index}>
            <div className="aspect-video rounded-lg bg-white/5" />
            <div className="mt-2 h-3 w-4/5 rounded bg-white/10" />
            <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
