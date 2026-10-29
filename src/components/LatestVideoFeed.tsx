"use client";
import { Loader2, RotateCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { PublicVideo } from "@/lib/public/catalog";
import type { FeedCursor } from "@/lib/public/watch-feed";
import {
  LATEST_FEED_ROOT_MARGIN,
  latestFeedBatchSize,
} from "@/lib/public/shelf";
import { gridStyle, useContainerColumns, useResponsiveGridRows } from "../hooks/useGridColumns";
import PublicVideoCard from "./PublicVideoCard";
import MobileAdSlot from "./ads/MobileAdSlot";
export default function LatestVideoFeed({
  videoId,
  adBase = 0,
}: {
  videoId: string;
  /** First mobile banner position, so feeds sharing a page never collide. */
  adBase?: number;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const columns = useContainerColumns(grid);
  const rowBatch = useResponsiveGridRows();
  const [videos, setVideos] = useState<PublicVideo[]>([]);
  const cursor = useRef<FeedCursor | null>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (lock.current || done) return;
    lock.current = true; setBusy(true); setError("");
    try {
      // Two shelves per request, requested while the sentinel is still two
      // screens away, so a fast scroll never waits for a batch to start.
      const params = new URLSearchParams({
        exclude: videoId,
        limit: String(latestFeedBatchSize(columns, rowBatch)),
      });
      if (cursor.current) { params.set("date", cursor.current.date); params.set("id", cursor.current.id); }
      const res = await fetch(`/api/videos/feed?${params}`);
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setVideos(old => [...old, ...data.videos.filter((v: PublicVideo) => !old.some(o => o.id === v.id))]);
      cursor.current = data.cursor; setDone(!data.cursor);
    } catch { setError("Unable to load videos. Try again."); }
    finally { lock.current = false; setBusy(false); }
  }, [videoId, columns, done, rowBatch]);
  useEffect(() => {
    if (done || error || !sentinel.current) return;
    if (typeof IntersectionObserver === "undefined") { if (!videos.length) void load(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) void load();
    }, { rootMargin: LATEST_FEED_ROOT_MARGIN });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [load, done, error, videos.length]);
  return <section className="mt-8 border-t border-line pt-5">
    <h2 className="text-[15px] font-semibold">Latest</h2>
    <div ref={grid} className="video-grid mt-3.5" style={gridStyle(columns)}>
      {videos.map((video, index) => (
        <Fragment key={video.id}>
          <PublicVideoCard video={video} />
          {/* Phones only: one 16:9 banner after every eight videos of the feed. */}
          {(index + 1) % 8 === 0 && (
            <MobileAdSlot position={adBase + Math.floor(index / 8)} inGrid />
          )}
        </Fragment>
      ))}
    </div>
    <div ref={sentinel} className="flex min-h-12 flex-col items-center justify-center py-6 text-center text-sm text-ink-3">
      {busy && (
        <span role="status" aria-label="Fetching more videos">
          <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden />
        </span>
      )}
      {error && <p role="alert">{error}</p>}
      {error && <button type="button" aria-label="Retry loading videos" title="Retry" onClick={() => void load()} className="mt-2 rounded-full p-2 text-ink-3 transition hover:text-ink"><RotateCw className="h-4 w-4" aria-hidden="true" /></button>}
      {done && <p>{videos.length ? "You’re all caught up." : "No more videos yet."}</p>}
    </div>
  </section>;
}
