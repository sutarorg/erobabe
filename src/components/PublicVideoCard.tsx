import Link from "next/link";
import { formatDuration } from "@/lib/site";
import type { PublicVideo } from "@/lib/public/catalog";

const FALLBACK_THUMB = "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

export default function PublicVideoCard({
  video,
  subtitle,
}: {
  video: PublicVideo;
  subtitle?: string;
}) {
  const caption =
    subtitle ??
    [video.category_label, video.view_count ? `${video.view_count} views` : null].filter(Boolean).join(" • ");

  return (
    <Link href={`/video/${video.slug}`} prefetch className="group">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-card">
        <img
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
      {caption ? <p className="mt-1 text-[11px] text-ink-3">{caption}</p> : null}
    </Link>
  );
}
