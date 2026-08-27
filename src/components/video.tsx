/**
 * Video display components: cards, grids, carousels, ranked lists,
 * category cards, and the share modal.
 */
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Check, ChevronLeft, ChevronRight, Copy, Link2, MessageCircle,
  Play, Send, Share2,
} from "lucide-react";
import { FALLBACK_THUMB, formatDuration, formatViews, timeAgo, type Category, type Video } from "../data/videos";
import { categoryName } from "../lib/api";
import { getCategoryIcon } from "../lib/icons";
import { getPrefs, useMediaQuery } from "../lib/store";
import { cn } from "../utils/cn";
import { Badge, Modal, SectionHeader } from "./ui";

/* ------------------------------------------------------------------ */
/* Thumbnail with hover preview + broken-image fallback                */
/* ------------------------------------------------------------------ */

export function Thumb({ video, className }: { video: Video; className?: string }) {
  const [preview, setPreview] = useState(false);
  const [errored, setErrored] = useState(false);
  const timer = useRef<number | null>(null);
  const canHover = useMediaQuery("(hover: hover)");
  const previewsOn = getPrefs().autoplayPreviews;

  const start = () => {
    if (!canHover || !previewsOn) return;
    timer.current = window.setTimeout(() => setPreview(true), 400);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    setPreview(false);
  };

  return (
    <div
      className={cn("group/thumb relative aspect-video overflow-hidden rounded-xl bg-eb-800", className)}
      onMouseEnter={start}
      onMouseLeave={stop}
    >
      <img
        src={errored ? FALLBACK_THUMB : video.thumbnail}
        alt={video.title}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        className={cn(
          "h-full w-full object-cover transition-all duration-300 group-hover/thumb:scale-[1.06]",
          preview && "opacity-0"
        )}
      />
      {preview && video.videoUrl && (
        <video
          src={video.videoUrl}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          className="anim-fade absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* gradient + hover veil */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover/thumb:bg-black/25" />

      {/* hover play */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-200 group-hover/thumb:opacity-100">
        <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full border border-white/20 bg-black/50 backdrop-blur-md transition-transform duration-200 group-hover/thumb:scale-100">
          <Play size={18} className="ml-0.5 fill-white text-white" />
        </span>
      </div>

      <Badge className="absolute right-2 bottom-2">{formatDuration(video.durationSec)}</Badge>
      {video.quality === "4K" && (
        <Badge className="absolute top-2 left-2 bg-gradient-to-r from-eb-rose to-eb-violet text-[9px] font-extrabold">
          4K
        </Badge>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Video card                                                          */
/* ------------------------------------------------------------------ */

export function VideoCard({ video, dense }: { video: Video; dense?: boolean }) {
  return (
    <Link to={`/watch/${video.id}`} className="group ring-focus block rounded-xl" aria-label={video.title}>
      <Thumb video={video} className="transition-shadow duration-300 group-hover:shadow-xl group-hover:shadow-eb-rose/10" />
      <div className="mt-2.5 flex gap-2.5 px-0.5">
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "line-clamp-2 text-[13px] leading-snug font-semibold text-eb-text transition-colors group-hover:text-white",
              dense && "text-xs"
            )}
          >
            {video.title}
          </h3>
          <p className="mt-1 truncate text-[11px] text-eb-faint">
            {formatViews(video.views)} views • {timeAgo(video.daysAgo)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-eb-muted">
            <span className="text-eb-rose-soft/90">{categoryName(video.category)}</span>
            {video.tags[0] ? ` • ${video.tags[0]}` : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}

export function VideoGrid({ videos, dense }: { videos: Video[]; dense?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {videos.map((v) => (
        <VideoCard key={v.id} video={v} dense={dense} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal carousel                                                 */
/* ------------------------------------------------------------------ */

export function VideoCarousel({
  title,
  subtitle,
  videos,
  viewAll,
}: {
  title: string;
  subtitle?: string;
  videos: Video[];
  viewAll?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: number) => {
    ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  };
  return (
    <section className="anim-fade-up">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        action={
          <div className="flex items-center gap-1">
            {viewAll && (
              <Link to={viewAll} className="ring-focus mr-1 rounded-full px-2 text-xs font-semibold text-eb-rose-soft hover:text-eb-rose">
                View all
              </Link>
            )}
            <button onClick={() => scrollBy(-1)} aria-label="Scroll left" className="ring-focus hidden h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-eb-line text-eb-muted transition hover:border-white/25 hover:text-white sm:flex">
              <ChevronLeft size={15} />
            </button>
            <button onClick={() => scrollBy(1)} aria-label="Scroll right" className="ring-focus hidden h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-eb-line text-eb-muted transition hover:border-white/25 hover:text-white sm:flex">
              <ChevronRight size={15} />
            </button>
          </div>
        }
      />
      <div
        ref={ref}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {videos.map((v) => (
          <div key={v.id} className="w-[62%] shrink-0 snap-start sm:w-[38%] md:w-[29%] lg:w-[23%] xl:w-[19%]">
            <VideoCard video={v} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ranked list (Most Watched)                                          */
/* ------------------------------------------------------------------ */

export function RankedList({ videos, className }: { videos: Video[]; className?: string }) {
  return (
    <ol className={cn("grid gap-x-8 gap-y-4 sm:grid-cols-2", className)}>
      {videos.map((v, i) => (
        <li key={v.id}>
          <Link to={`/watch/${v.id}`} className="group ring-focus flex items-center gap-4 rounded-xl p-1.5 transition hover:bg-white/[0.03]">
            <span className={cn("font-display w-10 shrink-0 text-center text-4xl font-bold outline-num transition group-hover:outline-num-accent", i < 3 && "outline-num-accent")}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-eb-800">
              <img src={v.thumbnail} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
              <Badge className="absolute right-1 bottom-1 text-[9px]">{formatDuration(v.durationSec)}</Badge>
            </div>
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-[13px] font-semibold text-eb-text group-hover:text-white">{v.title}</h3>
              <p className="mt-1 text-[11px] text-eb-faint">{formatViews(v.views)} views</p>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Category card                                                       */
/* ------------------------------------------------------------------ */

export function CategoryCard({ category, count }: { category: Category; count?: number }) {
  const Icon = getCategoryIcon(category.icon);
  return (
    <Link
      to={`/category/${category.slug}`}
      className="group ring-focus relative block aspect-[4/3] overflow-hidden rounded-2xl border border-eb-line sm:aspect-[16/10]"
      aria-label={`${category.name} category`}
    >
      <img
        src={category.image}
        alt={category.name}
        loading="lazy"
        onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)}
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-110"
      />
      <div className={cn("absolute inset-0 bg-gradient-to-t via-black/25 to-transparent", category.accent)} />
      <div className="absolute inset-0 bg-black/30 transition group-hover:bg-black/10" />
      <span className="absolute top-3 left-3 flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-black/45 text-white backdrop-blur-md transition-transform duration-300 group-hover:scale-110" aria-hidden>
        <Icon size={16} />
      </span>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <h3 className="font-display flex items-center gap-1.5 text-base font-bold text-white drop-shadow sm:text-lg">
          {category.name}
        </h3>
        <p className="mt-0.5 text-[11px] text-white/70">
          {typeof count === "number" ? `${count} videos` : category.blurb}
        </p>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Share modal                                                         */
/* ------------------------------------------------------------------ */

export function ShareModal({ video, open, onClose }: { video: Video; open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  void navigate;
  const url = `${window.location.origin}/watch/${video.id}`;
  const text = `${video.title} — EroBabe`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  const system = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: text, url });
      } catch {
        /* cancelled */
      }
    } else {
      copy();
    }
  };

  const options = [
    { icon: copied ? <Check size={17} /> : <Copy size={17} />, label: copied ? "Copied!" : "Copy link", onClick: copy },
    { icon: <Send size={17} />, label: "Telegram", href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
    { icon: <MessageCircle size={17} />, label: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
    { icon: <Share2 size={17} />, label: "More…", onClick: system },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Share this video">
      <div className="grid grid-cols-4 gap-2">
        {options.map((o) => (
          <button
            key={o.label}
            onClick={() => (o.href ? window.open(o.href, "_blank", "noopener") : o.onClick?.())}
            className="ring-focus flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-eb-line bg-eb-800 py-4 text-eb-muted transition hover:border-eb-rose/40 hover:text-white"
          >
            {o.icon}
            <span className="text-[10px] font-medium">{o.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-eb-line bg-eb-900 px-3 py-2.5">
        <Link2 size={14} className="shrink-0 text-eb-faint" />
        <span className="flex-1 truncate text-xs text-eb-muted">{url}</span>
        <button onClick={copy} className="ring-focus cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-eb-rose-soft hover:text-eb-rose">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </Modal>
  );
}
