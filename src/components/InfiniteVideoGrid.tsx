"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Video } from "../data/content";
import { GRID_ROWS, gridStyle, useContainerColumns } from "../hooks/useGridColumns";
import VideoCard from "./VideoCard";

interface InfiniteVideoGridProps {
  /** Source pool — cycled to simulate an endless feed. */
  pool: Video[];
  onOpen: (video: Video) => void;
  /** Total row cap for the demo feed. */
  maxRows?: number;
}

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video rounded-lg border border-line bg-card" />
      <div className="mt-2 h-3 w-4/5 rounded bg-card" />
      <div className="mt-1.5 h-2.5 w-2/5 rounded bg-card" />
    </div>
  );
}

/**
 * YouTube-style endless feed: an IntersectionObserver sentinel auto-loads the
 * next four rows as the visitor scrolls, with skeleton placeholders during the
 * simulated fetch.
 *
 * The item count is derived from `rows × columns`, so every batch is a whole
 * number of rows at the measured container width — the grid never shows a
 * partial row or a stray fifth row.
 * All data is local — no network requests are made.
 */
export default function InfiniteVideoGrid({
  pool,
  onOpen,
  maxRows = 24,
}: InfiniteVideoGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useContainerColumns(gridRef);
  const [rows, setRows] = useState(GRID_ROWS);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const done = rows >= maxRows;
  const count = Math.min(rows, maxRows) * columns;

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || done) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loading) return;
        setLoading(true);
        // Simulated latency so the skeletons are perceivable, like a real feed.
        timerRef.current = window.setTimeout(() => {
          setRows((r) => Math.min(maxRows, r + GRID_ROWS));
          setLoading(false);
        }, 550);
      },
      { rootMargin: "240px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, done, maxRows]);

  // Cycle the pool so the feed keeps producing fresh-looking rows.
  const items = Array.from({ length: count }, (_, i) => ({
    video: pool[i % pool.length],
    key: `${pool[i % pool.length].id}-${Math.floor(i / pool.length)}`,
  }));

  return (
    <>
      {/* mt matches the fixed-grid sections so every heading sits the same
          distance above its first row of thumbnails. */}
      <div ref={gridRef} className="video-grid mt-3.5" style={gridStyle(columns)}>
        {items.map(({ video, key }) => (
          <VideoCard key={key} video={video} onOpen={onOpen} />
        ))}
        {loading && Array.from({ length: columns }, (_, i) => <Skeleton key={`sk-${i}`} />)}
      </div>

      {/* sentinel */}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />

      <div className="flex justify-center py-6" aria-live="polite">
        {loading ? (
          <span role="status" aria-label="Fetching more videos" className="flex items-center text-[12px] text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
          </span>
        ) : done ? (
          <span className="text-[12px] text-ink-3">You&apos;ve reached the end.</span>
        ) : null}
      </div>
    </>
  );
}
