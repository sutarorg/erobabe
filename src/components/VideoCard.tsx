"use client";
import { Eye, Play } from "lucide-react";
import type { Video } from "../data/content";
import { cn } from "../utils/cn";

interface VideoCardProps {
  video: Video;
  onOpen?: (video: Video) => void;
  dense?: boolean;
}

export default function VideoCard({ video, onOpen, dense = false }: VideoCardProps) {
  const href = `/video/${video.id}`;
  const content = (
    <>
      <span className="relative block aspect-video overflow-hidden rounded-lg border border-line bg-card transition-colors duration-200 group-hover:border-accent/40">
        <img
          src={video.thumb}
          alt={video.alt}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.045]"
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
        <span className="absolute left-1.5 top-1.5 rounded border border-white/10 bg-black/65 px-1.5 py-[2px] text-[9px] font-semibold tracking-[0.08em] text-zinc-100 backdrop-blur-sm">
          {video.quality}
        </span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-[2px] text-[10px] font-medium tabular-nums text-zinc-100 backdrop-blur-sm">
          {video.duration}
        </span>
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100"
        >
          <span className="flex h-9 w-9 scale-90 items-center justify-center rounded-full bg-accent/95 shadow-[0_4px_16px_rgba(245,22,85,0.45)] transition-transform duration-300 group-hover:scale-100">
            <Play className="ml-0.5 h-3.5 w-3.5 fill-current text-white" />
          </span>
        </span>
      </span>

      <span className={cn("block", dense ? "mt-1.5" : "mt-2")}>
        <span
          className={cn(
            "block truncate font-medium text-zinc-100 transition-colors group-hover:text-white",
            dense ? "text-[12px]" : "text-[13px]"
          )}
        >
          {video.title}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
          <Eye className="h-3 w-3 shrink-0" aria-hidden />
          <span className="tabular-nums">{video.views}</span>
          {!dense && (
            <>
              <span aria-hidden>•</span>
              <span className="truncate">{video.added}</span>
            </>
          )}
          <span className="ml-auto shrink-0 font-medium tabular-nums text-emerald-500">
            {video.rating}%
          </span>
        </span>
      </span>
    </>
  );

  // If onOpen provided (legacy), render button that also navigates via href for SEO
  if (onOpen) {
    return (
      <a
        href={href}
        onClick={(e) => {
          // Allow client-side navigation if onOpen handles it, but preserve crawlable href
          if (onOpen) {
            e.preventDefault();
            onOpen(video);
          }
        }}
        className="group block w-full text-left"
        aria-label={`${video.title} — ${video.duration}, ${video.views} views`}
      >
        {content}
      </a>
    );
  }

  return (
    <a href={href} className="group block w-full text-left" aria-label={`${video.title} — ${video.duration}`}>
      {content}
    </a>
  );
}
