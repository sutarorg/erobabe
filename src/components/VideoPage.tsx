"use client";
import {
  ArrowLeft, Bookmark, Check, Eye, Maximize2, Play, Settings, Share2, ThumbsUp, Volume2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { VIDEOS, type Video } from "../data/content";
import { cn } from "../utils/cn";
import Categories from "./Categories";
import InfiniteVideoGrid from "./InfiniteVideoGrid";
import VideoGrid from "./VideoGrid";

interface VideoPageProps {
  video: Video;
  liked: boolean;
  onToggleLike: () => void;
  onBack: () => void;
  onOpen: (video: Video) => void;
  onSelectCategory?: (label: string) => void;
}

/** Deterministic shuffle so "Recommended" stays stable per video. */
function seededOrder(items: Video[], seed: string) {
  const base = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return [...items]
    .map((v, i) => ({ v, k: ((i + 1) * 2654435761 + base) % 100000 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

/** Shared section — always exactly four rows at the current column count. */
function GridSection({
  title,
  sub,
  videos,
  onOpen,
}: {
  title: string;
  sub?: string;
  videos: Video[];
  onOpen: (video: Video) => void;
}) {
  return (
    <section className="mt-8 border-t border-line pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {sub && <span className="text-[11.5px] text-ink-3">{sub}</span>}
      </div>
      <VideoGrid videos={videos} onOpen={onOpen} className="video-grid mt-3.5" />
    </section>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 @sm:px-5 @2xl:px-7">{children}</div>
  );
}

/**
 * Standalone /video/{slug} watch page (hash-routed inside the public site).
 * The player is a styled placeholder — no media is hosted or streamed.
 */
export default function VideoPage({
  video,
  liked,
  onToggleLike,
  onBack,
  onOpen,
  onSelectCategory,
}: VideoPageProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const others = useMemo(() => VIDEOS.filter((v) => v.id !== video.id), [video.id]);

  /* Up to 16 each → four rows with at most four columns. */
  const moreLikeThis = useMemo(() => {
    const same = others.filter((v) => v.category === video.category);
    const rest = others.filter((v) => v.category !== video.category);
    return [...same, ...rest].slice(0, 16);
  }, [others, video.category]);

  const recommended = useMemo(
    () => seededOrder(others, video.id).slice(0, 16),
    [others, video.id]
  );

  const topRated = useMemo(
    () => [...others].sort((a, b) => b.rating - a.rating || b.viewsNum - a.viewsNum).slice(0, 16),
    [others]
  );

  const latestPool = useMemo(
    () => [...others].sort((a, b) => a.daysAgo - b.daysAgo),
    [others]
  );

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* clipboard optional in demo */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Shell>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to browse
      </button>

      {/* placeholder player */}
      <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-line bg-black">
        <img src={video.thumb} alt={video.alt} draggable={false} className="h-full w-full object-cover opacity-55" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" aria-hidden />
        <span className="absolute left-2.5 top-2.5 rounded border border-white/10 bg-black/65 px-2 py-[3px] text-[10px] font-semibold tracking-[0.08em] text-zinc-100 backdrop-blur-sm">
          {video.quality}
        </span>
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            aria-label="Play video (demo player)"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-[0_10px_36px_rgba(245,22,85,0.5)] transition-transform duration-200 hover:scale-105"
          >
            <Play className="ml-1 h-6 w-6 fill-current" aria-hidden />
          </button>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex h-11 items-center gap-3 bg-gradient-to-t from-black/85 to-transparent px-3.5">
          <Play className="h-3.5 w-3.5 fill-current text-zinc-200" aria-hidden />
          <Volume2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={34} aria-valuemin={0} aria-valuemax={100} aria-label="Playback progress (demo)">
            <div className="h-full w-[34%] rounded-full bg-accent" />
          </div>
          <span className="text-[10px] tabular-nums text-zinc-400">8:24 / {video.duration}</span>
          <Settings className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
          <Maximize2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
        </div>
      </div>

      {/* metadata */}
      <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">{video.title}</h1>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" aria-hidden />
          <span className="tabular-nums">{video.views} views</span>
        </span>
        <span aria-hidden>•</span>
        <span>{video.added}</span>
        <span aria-hidden>•</span>
        <span className="tabular-nums">{video.duration}</span>
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleLike}
          aria-pressed={liked}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors",
            liked ? "border-accent/60 bg-accent/12 text-accent" : "border-line bg-card text-ink-2 hover:border-zinc-600 hover:text-ink"
          )}
        >
          <ThumbsUp className={cn("h-3.5 w-3.5", liked && "fill-current")} aria-hidden />
          {liked ? "Liked" : "Like"}
        </button>
        <button
          type="button"
          onClick={() => setSaved((s) => !s)}
          aria-pressed={saved}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors",
            saved ? "border-accent/60 bg-accent/12 text-accent" : "border-line bg-card text-ink-2 hover:border-zinc-600 hover:text-ink"
          )}
        >
          <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} aria-hidden />
          {saved ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          onClick={share}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-3 text-[12px] font-medium text-ink-2 transition-colors hover:border-zinc-600 hover:text-ink"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> : <Share2 className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied" : "Share"}
        </button>
        <span className="ml-auto flex items-center gap-2">
          <span className="rounded-full border border-accent/45 bg-accent/8 px-2.5 py-[3px] text-[10.5px] font-semibold text-accent">
            {video.category}
          </span>
          <span className="rounded-full border border-white/10 bg-card px-2.5 py-[3px] text-[10.5px] font-semibold text-ink-2">
            {video.quality}
          </span>
          <span className="rounded-full border border-white/10 bg-card px-2.5 py-[3px] text-[10.5px] font-semibold tabular-nums text-emerald-500">
            {video.rating}%
          </span>
        </span>
      </div>

      <p className="mt-4 max-w-[640px] text-[13px] leading-relaxed text-ink-2">{video.description}</p>
      <p className="mt-2 text-[11px] text-ink-3">
        Demo watch page — the player is a placeholder. No media is hosted or streamed.
      </p>

      {/* Four rows, at most four columns each. */}
      <GridSection title="More like this" sub={video.category} videos={moreLikeThis} onOpen={onOpen} />
      <GridSection title="Recommended" sub="Picked for you" videos={recommended} onOpen={onOpen} />
      <GridSection title="Top Rated" sub="Highest rated right now" videos={topRated} onOpen={onOpen} />

      {/* Top categories */}
      <section className="mt-8 border-t border-line pt-5">
        <Categories activeCategory={video.category} onSelect={onSelectCategory} />
      </section>

      {/* endless feed */}
      <section className="mt-8 border-t border-line pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Latest</h2>
          <span className="text-[11.5px] text-ink-3">Keeps loading as you scroll</span>
        </div>
        <InfiniteVideoGrid pool={latestPool} onOpen={onOpen} />
      </section>
    </Shell>
  );
}
