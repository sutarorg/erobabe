"use client";
import { VIDEOS, type Video } from "../data/content";
import VideoCard from "./VideoCard";

interface LatestPageProps {
  onOpen: (video: Video) => void;
}

/** /latest — every upload, newest first. */
export default function LatestPage({ onOpen }: LatestPageProps) {
  const latest = [...VIDEOS].sort((a, b) => a.daysAgo - b.daysAgo);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 @sm:px-5 @2xl:px-7">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">Fresh this week</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Latest Videos</h1>
        <span className="text-[12px] tabular-nums text-ink-3">{latest.length} videos</span>
      </div>
      <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-ink-3">
        New scenes land every day — here is everything uploaded most recently.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-x-3.5 gap-y-6 @sm:grid-cols-3 @2xl:grid-cols-4">
        {latest.map((video) => (
          <VideoCard key={video.id} video={video} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
