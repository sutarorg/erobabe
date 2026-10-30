"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Switching videos must look instantaneous.
 *
 * The App Router keeps the current page (and its `<video>`) on screen until the
 * next route's payload has arrived. On a watch page that is exactly wrong: the
 * visitor has already decided to watch something else, but the old player keeps
 * buffering and the screen does not change, so the click looks broken — worst
 * of all while that old video is still loading, when the new one is queued
 * behind a download nobody wants any more.
 *
 * This wrapper watches the clicks that leave the current video and swaps the
 * page for its own skeleton *before* the navigation resolves. The player is
 * unmounted by that swap, which is what cancels its download; the skeleton
 * then stays until the destination renders.
 *
 * A route-level `loading.tsx` would do the same thing, but it also forces the
 * whole segment to stream, and a streamed response has already sent `200 OK` by
 * the time the page can call `notFound()` — every mistyped URL would become a
 * soft 404. Keeping the boundary inside the page keeps real 404s for real.
 */
export function WatchTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);

  // The destination has rendered: the skeleton has done its job.
  useEffect(() => {
    setPending(null);
  }, [pathname]);

  // If the navigation never completes (offline, cancelled fetch, a route that
  // throws), the visitor gets the player back instead of a skeleton for ever.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), 15_000);
    return () => clearTimeout(timer);
  }, [pending]);

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Capture phase, so this runs before the link's own handler.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") || "";
      if (!href.startsWith("/video/")) return;
      const [path] = href.split(/[?#]/);
      // Re-clicking the video that is already playing is not a switch.
      if (!path || path === pathname) return;
      setPending(path);
    },
    [pathname],
  );

  if (pending) return <WatchSkeleton />;

  return (
    <div onClickCapture={onClick} data-watch-transition="">
      {children}
    </div>
  );
}

/**
 * The watch page's shape, without its data.
 *
 * Same aspect ratio, radius and rhythm as the real page so the switch lands on
 * a stable layout rather than a jump: the title, meta line, action row, copy and
 * one shelf are all reserved where they will appear.
 */
export function WatchSkeleton() {
  return (
    <div className="pt-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading video…</span>

      <div className="aspect-video w-full animate-pulse rounded-xl border border-line bg-card" />

      <div className="mt-4 space-y-2">
        <div className="h-5 w-3/4 max-w-[520px] rounded bg-white/10" />
        <div className="h-3 w-40 rounded bg-white/5" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <div className="h-7 w-24 rounded-full bg-white/5" />
        <div className="h-7 w-20 rounded-full bg-white/5" />
      </div>

      <div className="mt-6 h-3 w-full max-w-[640px] rounded bg-white/5" />
      <div className="mt-2 h-3 w-2/3 max-w-[420px] rounded bg-white/5" />

      <section className="mt-8 border-t border-line pt-5" aria-label="Loading more videos">
        <div className="h-4 w-36 rounded bg-white/10" />
        <div className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index}>
              <div className="aspect-video animate-pulse rounded-lg bg-card" />
              <div className="mt-2 h-3 w-4/5 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default WatchTransition;
