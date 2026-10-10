"use client";
import { ArrowLeft, SearchX } from "lucide-react";
import { ALL_CATEGORIES, type Video } from "../data/content";
import { cn } from "../utils/cn";
import VideoCard from "./VideoCard";

interface BrowseViewProps {
  eyebrow: string;
  title: string;
  videos: Video[];
  /** Search results hide the category chips. */
  showFilters: boolean;
  activeCategory: string | null;
  onCategory: (label: string | null) => void;
  onClear: () => void;
  onOpen: (video: Video) => void;
}

/** Every browsable category, so Browse and Top Rated cover the full index. */
const CHIP_CATEGORIES = ALL_CATEGORIES.map((c) => c.label);

export default function BrowseView({
  eyebrow,
  title,
  videos,
  showFilters,
  activeCategory,
  onCategory,
  onClear,
  onOpen,
}: BrowseViewProps) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-5 @sm:px-5 @2xl:px-7">
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to home
      </button>

      <p className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">
        {eyebrow}
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
        <span className="text-[12px] tabular-nums text-ink-3">
          {videos.length} {videos.length === 1 ? "video" : "videos"}
        </span>
      </div>

      {showFilters && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          {["All", ...CHIP_CATEGORIES].map((label) => {
            const active =
              label === "All" ? activeCategory === null : activeCategory === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onCategory(label === "All" ? null : label)}
                aria-pressed={active}
                className={cn(
                  "flex h-7 items-center rounded-full border px-3 text-[11.5px] font-medium transition-colors",
                  active
                    ? "border-accent/60 bg-accent/12 text-accent"
                    : "border-line bg-card text-ink-2 hover:border-zinc-600 hover:text-ink"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {videos.length > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-x-3.5 gap-y-6 @sm:grid-cols-3 @2xl:grid-cols-4">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-line py-16 text-center">
          <SearchX className="h-8 w-8 text-ink-3" aria-hidden />
          <p className="mt-3 text-[14px] font-medium text-ink">No videos found</p>
          <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-ink-3">
            Try a different search term or browse one of the categories instead.
          </p>
          <button
            type="button"
            onClick={onClear}
            className="mt-4 flex h-8 items-center rounded-md bg-accent px-4 text-[12px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
