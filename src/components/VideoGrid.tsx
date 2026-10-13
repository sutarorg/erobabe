"use client";
import type { Video } from "../data/content";
import FourRowVideoGrid from "./FourRowVideoGrid";
import VideoCard from "./VideoCard";

interface VideoGridProps {
  videos: Video[];
  /**
   * Optional — omit when rendering from a Server Component. Cards then
   * navigate to /video/[slug] on their own.
   */
  onOpen?: (video: Video) => void;
  className?: string;
}

/** Four rows of cards, with at most four columns at any container width. */
export default function VideoGrid({
  videos,
  onOpen,
  className = "video-grid",
}: VideoGridProps) {
  return (
    <FourRowVideoGrid className={className}>
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} onOpen={onOpen} />
      ))}
    </FourRowVideoGrid>
  );
}
