import { cn } from "@/lib/format";

export function CardSkeleton() {
  return (
    <div>
      <div className="skeleton aspect-video rounded-xl" />
      <div className="mt-2.5 space-y-2 px-0.5">
        <div className="skeleton h-3.5 w-11/12 rounded" />
        <div className="skeleton h-3 w-2/5 rounded" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 10, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-3 md:gap-y-8 xl:grid-cols-4 2xl:grid-cols-5", className)}>
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <div className="space-y-8">
      <div className="skeleton aspect-[4/5] rounded-2xl sm:aspect-[21/9] md:rounded-3xl" />
      <GridSkeleton count={8} />
    </div>
  );
}

export function WatchSkeleton() {
  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
      <div>
        <div className="skeleton aspect-video rounded-2xl" />
        <div className="mt-4 space-y-3">
          <div className="skeleton h-5 w-3/4 rounded" />
          <div className="skeleton h-3.5 w-1/3 rounded" />
          <div className="skeleton h-10 w-full rounded-xl" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton aspect-video w-40 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2 py-1">
              <div className="skeleton h-3.5 w-full rounded" />
              <div className="skeleton h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full-route fallback used while lazy pages load. */
export function RouteLoading() {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8" aria-label="Loading content">
      <div className="skeleton mb-6 h-7 w-48 rounded-lg" />
      <GridSkeleton count={10} />
    </div>
  );
}
