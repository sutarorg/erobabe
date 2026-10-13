import Link from "next/link";
import { Eye } from "lucide-react";
import { formatDuration, formatTimeAgo } from "@/lib/site";
import type { PublicVideo } from "@/lib/public/catalog";
import ThumbImage from "./ThumbImage";

const FALLBACK_THUMB = "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

export default function PublicVideoCard({ video }: { video: PublicVideo }) {
  const publishedDate = video.published_at ? new Date(video.published_at) : null;
  const dateTime = publishedDate && Number.isFinite(publishedDate.getTime())
    ? publishedDate.toISOString()
    : undefined;

  return (
    <Link href={`/video/${video.slug}`} prefetch className="group min-w-0">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-card">
        <ThumbImage
          src={video.thumbnail_url || FALLBACK_THUMB}
          alt={video.title}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
        {video.duration_seconds ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
            {formatDuration(video.duration_seconds)}
          </span>
        ) : null}
        {video.quality ? (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">
            {video.quality}
          </span>
        ) : null}
      </div>
      <h3 className="mt-2 line-clamp-2 text-[13px] font-medium leading-tight text-ink group-hover:text-accent">{video.title}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <Eye className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">{video.view_count.toLocaleString("en-US")} views</span>
        </span>
        <span aria-hidden>•</span>
        <time dateTime={dateTime} className="whitespace-nowrap">{formatTimeAgo(video.published_at)}</time>
      </div>
    </Link>
  );
}
