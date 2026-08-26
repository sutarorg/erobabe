import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Film, Flame, Play, Sparkles } from "lucide-react";
import type { Video } from "@/data/videos";
import { categoryName } from "@/data/videos";
import { useUi } from "@/context/ui";
import { cn } from "@/lib/format";

/**
 * The core content unit: 16:9 thumb, duration badge, hover zoom + play
 * affordance, optional muted preview (opt-in preference), title & metadata.
 */
export function VideoCard({ video, priority = false, className }: { video: Video; priority?: boolean; className?: string }) {
  const { prefs } = useUi();
  const [preview, setPreview] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [imgError, setImgError] = useState(false);
  const timer = useRef<number | null>(null);
  const hoverable = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  const startPreview = () => {
    if (!prefs.preview || !hoverable.current) return;
    timer.current = window.setTimeout(() => setPreview(true), 450);
  };
  const stopPreview = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setPreview(false);
    setPreviewReady(false);
  };
  useEffect(() => stopPreview, []);

  return (
    <Link
      to={`/watch/${video.id}`}
      aria-label={`Watch ${video.title}`}
      className={cn("group block outline-none", className)}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      onFocus={startPreview}
      onBlur={stopPreview}
    >
      <figure className="relative aspect-video overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/8 transition duration-300 group-hover:ring-white/20 group-focus-visible:ring-2 group-focus-visible:ring-brand-500/60">
        {imgError ? (
          /* Broken-thumbnail fallback */
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-ink-700 to-ink-850">
            <Film className="size-8 text-fog-600" aria-hidden />
          </div>
        ) : (
          <img
            src={video.thumbnail}
            alt={`${video.title} thumbnail`}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : undefined}
            onError={() => setImgError(true)}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105",
              preview && previewReady && "opacity-0"
            )}
          />
        )}

        {/* Muted hover preview (opt-in) */}
        {preview && (
          <video
            src={video.videoUrl}
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
            aria-hidden
            onCanPlay={() => setPreviewReady(true)}
            className={cn(
              "absolute inset-0 h-full w-full scale-105 object-cover transition-opacity duration-500",
              previewReady ? "opacity-100" : "opacity-0"
            )}
          />
        )}

        {/* Hover scrim + play affordance */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 transition duration-300 group-hover:opacity-100"
          aria-hidden
        />
        <span
          className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 scale-75 place-items-center rounded-full border border-white/25 bg-black/45 text-white opacity-0 backdrop-blur transition duration-300 group-hover:scale-100 group-hover:opacity-100"
          aria-hidden
        >
          <Play className="ml-0.5 size-5 fill-white" />
        </span>

        {/* Badges */}
        <span className="glass absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
          {video.durationLabel}
        </span>
        {video.isNew && !video.hot && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-violet-600/90 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
            <Sparkles className="size-2.5" aria-hidden /> NEW
          </span>
        )}
        {video.hot && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-brand-500 to-brand-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
            <Flame className="size-2.5" aria-hidden /> HOT
          </span>
        )}
      </figure>

      <div className="mt-2.5 space-y-1 px-0.5">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-fog-100 transition group-hover:text-white md:text-sm">
          {video.title}
        </h3>
        <p className="text-xs text-fog-500">
          {video.viewsLabel} views <span className="text-fog-600">·</span> {video.dateLabel}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-fog-400">
            {categoryName(video.category)}
          </span>
          {video.tags.slice(1, 2).map((t) => (
            <span key={t} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-fog-500">
              {t}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
