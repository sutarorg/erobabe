"use client";
import { useRef } from "react";
import type { Video } from "../data/content";
import { gridItemCount, gridStyle, useContainerColumns } from "../hooks/useGridColumns";
import VideoCard from "./VideoCard";

interface VideoGridProps {
  videos: Video[];
  /**
   * Optional — omit when rendering from a Server Component. Cards then
   * navigate to /video/[slug] on their own.
   */
  onOpen?: (video: Video) => void;
  /** Widest column count the section may use. */
  maxColumns?: 4 | 5;
  className?: string;
}

/**
 * A video grid that is always exactly four rows tall.
 *
 * Columns are derived from the grid's own measured width and applied inline,
 * and the item count follows that same number — so stepping from 5 to 4 to 3
 * columns trims the row instead of spilling into a fifth.
 */
export default function VideoGrid({
  videos,
  onOpen,
  maxColumns = 5,
  className = "video-grid",
}: VideoGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useContainerColumns(gridRef, maxColumns);
  const shown = videos.slice(0, gridItemCount(columns));

  return (
    <div ref={gridRef} className={className} style={gridStyle(columns)}>
      {shown.map((video) => (
        <VideoCard key={video.id} video={video} onOpen={onOpen} />
      ))}
    </div>
  );
}
