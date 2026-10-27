"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicVideo } from "@/lib/public/catalog";
import PublicVideoCard from "./PublicVideoCard";

type Cursor = { date: string; id: string } | null;
export default function PaginatedLatestFeed({ initialVideos, initialCursor }: { initialVideos: PublicVideo[]; initialCursor: Cursor }) {
  const [videos, setVideos] = useState(initialVideos);
  const [cursor, setCursor] = useState<Cursor>(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(!initialCursor);
  const sentinel = useRef<HTMLDivElement>(null);
  const lock = useRef(false);

  const load = useCallback(async () => {
    if (lock.current || done || !cursor) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ surface: "latest", limit: "24", date: cursor.date, id: cursor.id });
      const response = await fetch(`/api/videos/feed?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error("Feed unavailable");
      const seen = new Set(videos.map((video) => video.id));
      setVideos((previous) => [...previous, ...result.videos.filter((video: PublicVideo) => !seen.has(video.id))]);
      setCursor(result.cursor);
      setDone(!result.cursor);
    } catch {
      setError("Unable to load more videos. Please retry.");
    } finally { lock.current = false; setBusy(false); }
  }, [cursor, done, videos]);

  useEffect(() => {
    if (!sentinel.current || done || error) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void load(); }, { rootMargin: "480px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [load, done, error]);

  return <>
    <div className="mt-6 grid grid-cols-1 gap-4 @md:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4">
      {videos.map((video) => <PublicVideoCard key={video.id} video={video} />)}
    </div>
    <div ref={sentinel} className="flex min-h-16 flex-col items-center justify-center py-5 text-center text-[12px] text-ink-3">
      {busy && <span role="status">Loading more videos…</span>}
      {error && <p role="alert">{error}</p>}
      {error && <button type="button" onClick={() => void load()} className="mt-2 rounded border border-line px-3 py-1.5">Retry</button>}
      {done && videos.length > 0 && <p>You’re all caught up.</p>}
    </div>
  </>;
}
