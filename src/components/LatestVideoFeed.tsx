"use client";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicVideo } from "@/lib/public/catalog";
import type { FeedCursor } from "@/lib/public/watch-feed";
import { gridStyle, useContainerColumns } from "../hooks/useGridColumns";
import PublicVideoCard from "./PublicVideoCard";
export default function LatestVideoFeed({ videoId }: { videoId: string }) {
  const grid = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const columns = useContainerColumns(grid);
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
      const params = new URLSearchParams({ exclude: videoId, limit: String(columns * 4) });
      if (cursor.current) { params.set("date", cursor.current.date); params.set("id", cursor.current.id); }
      const res = await fetch(`/api/videos/feed?${params}`);
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setVideos(old => [...old, ...data.videos.filter((v: PublicVideo) => !old.some(o => o.id === v.id))]);
      cursor.current = data.cursor; setDone(!data.cursor);
    } catch { setError("Unable to load videos. Try again."); }
    finally { lock.current = false; setBusy(false); }
  }, [videoId, columns, done]);
  useEffect(() => {
    if (done || error || !sentinel.current) return;
    if (typeof IntersectionObserver === "undefined") { if (!videos.length) void load(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) void load();
    }, { rootMargin: "400px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [load, done, error, videos.length]);
  return <section className="mt-8 border-t border-line pt-5">
    <h2 className="text-[15px] font-semibold">Latest</h2>
    <div ref={grid} className="video-grid mt-3.5" style={gridStyle(columns)}>{videos.map(v => <PublicVideoCard key={v.id} video={v} />)}</div>
    <div ref={sentinel} className="flex min-h-12 flex-col items-center justify-center py-6 text-center text-sm text-ink-3">
      {busy && (
        <span role="status" aria-label="Fetching more videos">
          <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden />
        </span>
      )}
      {error && <p role="alert">{error}</p>}
      {!done && <button disabled={busy} onClick={() => void load()} className="mt-2 rounded-lg border border-line px-4 py-2 disabled:opacity-50">{error ? "Retry" : "Load more"}</button>}
      {done && <p>{videos.length ? "You’re all caught up." : "No more videos yet."}</p>}
    </div>
  </section>;
}
