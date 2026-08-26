import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BadgeCheck, Bookmark, CalendarDays, ChevronDown, Eye, Flame, Link2,
  Share2, ThumbsUp, VideoOff, type LucideIcon,
} from "lucide-react";
import { CAPTIONS_URL, categoryName, getVideoById, relatedVideos, type Video } from "@/data/videos";
import { trackView } from "@/data/dynamic";
import { useHistory, useLikes, useSaved } from "@/hooks/store";
import { absUrl, isoDuration, siteOrigin, useSEO } from "@/lib/seo";
import { Player } from "@/components/Player";
import { ShareModal } from "@/components/ShareModal";
import { EmptyState, Tag } from "@/components/Sections";
import { toast } from "@/components/Feedback";
import { cn, fullDate } from "@/lib/format";

function ActionButton({
  icon: Icon, label, active, onClick,
}: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-semibold transition active:scale-95",
        active
          ? "border-transparent bg-gradient-to-r from-brand-500 to-violet-600 text-white shadow-[0_8px_24px_-8px_rgba(244,63,127,0.6)]"
          : "border-white/10 bg-ink-800/80 text-fog-300 hover:border-white/20 hover:text-white"
      )}
    >
      <Icon className={cn("size-4", active && "fill-white")} aria-hidden />
      {label}
    </button>
  );
}

function RecoRow({ video }: { video: Video }) {
  return (
    <Link to={`/watch/${video.id}`} className="group flex gap-3">
      <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8 sm:w-44">
        <img
          src={video.thumbnail}
          alt={`${video.title} thumbnail`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        <span className="glass absolute bottom-1 right-1 rounded px-1 py-px text-[10px] font-semibold text-white">
          {video.durationLabel}
        </span>
        {video.trending && (
          <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-md bg-brand-500/90">
            <Flame className="size-3 text-white" aria-hidden />
          </span>
        )}
      </div>
      <div className="min-w-0 py-0.5">
        <h4 className="line-clamp-2 text-[13px] font-medium leading-snug text-fog-100 transition group-hover:text-brand-300">
          {video.title}
        </h4>
        <p className="mt-1 text-xs text-fog-500">{categoryName(video.category)}</p>
        <p className="mt-0.5 text-[11px] text-fog-600">
          {video.viewsLabel} views · {video.dateLabel}
        </p>
      </div>
    </Link>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/6 bg-ink-900/50 p-4 md:p-5", className)}>{children}</div>
  );
}

export default function Watch() {
  const { id } = useParams();
  const video = id ? getVideoById(id) : undefined;

  const history = useHistory();
  const likes = useLikes();
  const saved = useSaved();
  const [shareOpen, setShareOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const watchTitle = video ? `${video.title} — EroBabe 18+` : "Video unavailable — EroBabe";
  const watchDescription = video
    ? (video.description || `Watch ${video.title} online on EroBabe.`).replace(/\s+/g, " ").slice(0, 155)
    : undefined;
  const uploadDate = video ? new Date(Date.now() - video.daysAgo * 86_400_000).toISOString() : undefined;

  useSEO(
    video
      ? {
          title: watchTitle,
          description: watchDescription,
          canonical: `${siteOrigin()}/watch/${video.id}`,
          type: "video.other",
          image: video.thumbnail,
          video: {
            url: absUrl(video.videoUrl),
            durationS: video.duration,
            publishedAt: uploadDate,
          },
          schema: {
            "@context": "https://schema.org",
            "@type": "VideoObject",
            name: video.title,
            description: watchDescription,
            thumbnailUrl: [absUrl(video.thumbnail)],
            uploadDate,
            datePublished: uploadDate,
            duration: isoDuration(video.duration),
            contentUrl: absUrl(video.videoUrl),
            embedUrl: `${siteOrigin()}/watch/${video.id}`,
            isFamilyFriendly: false,
            interactionStatistic: {
              "@type": "InteractionCounter",
              interactionType: { "@type": "WatchAction" },
              userInteractionCount: video.views,
            },
          },
        }
      : { title: watchTitle, robots: "noindex" }
  );

  useEffect(() => {
    if (video) {
      history.add(video.id);
      trackView(video.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  if (!video) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-16 md:px-8">
        <EmptyState
          icon={VideoOff}
          title="Video unavailable"
          body="This video may have been removed, or the link is invalid. Try exploring what's trending instead."
          action={
            <Link
              to="/trending"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-6 text-sm font-semibold text-white transition hover:brightness-110"
            >
              <Flame className="size-4" aria-hidden />
              Browse trending
            </Link>
          }
        />
      </div>
    );
  }

  const liked = likes.has(video.id);
  const isSaved = saved.has(video.id);
  const url = `${window.location.origin}/watch/${video.id}`;
  const related = relatedVideos(video, 10);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* noop — insecure context */
    }
    toast("Link copied to clipboard");
  };

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-4 md:px-8 md:pt-6">
      <div className="grid gap-8 xl:grid-cols-[1fr_380px]">
        {/* ── Main column ── */}
        <div className="min-w-0">
          <Player src={video.videoUrl} poster={video.thumbnail} title={video.title} captionsUrl={CAPTIONS_URL} />

          <h1 className="mt-4 text-lg font-semibold leading-snug tracking-tight text-white md:text-2xl">
            {video.title}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fog-400 md:text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Eye className="size-4 text-fog-500" aria-hidden />
              {video.viewsLabel} views
            </span>
            <span className="inline-flex items-center gap-1.5" title={fullDate(video.daysAgo)}>
              <CalendarDays className="size-4 text-fog-500" aria-hidden />
              {video.dateLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ThumbsUp className="size-4 text-fog-500" aria-hidden />
              {video.likeRatio}% liked
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BadgeCheck className="size-4 text-fog-500" aria-hidden />
              {video.durationLabel}
            </span>
          </div>

          {/* Actions */}
          <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
            <ActionButton
              icon={ThumbsUp}
              label={liked ? "Liked" : "Like"}
              active={liked}
              onClick={() => {
                likes.toggle(video.id);
                toast(liked ? "Removed like" : "Added to liked videos");
              }}
            />
            <ActionButton
              icon={Bookmark}
              label={isSaved ? "Saved" : "Save"}
              active={isSaved}
              onClick={() => {
                saved.toggle(video.id);
                toast(isSaved ? "Removed from saved" : "Saved for later");
              }}
            />
            <ActionButton icon={Share2} label="Share" onClick={() => setShareOpen(true)} />
            <ActionButton icon={Link2} label="Copy link" onClick={copyLink} />
          </div>

          {/* Description */}
          <Panel className="mt-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag label={categoryName(video.category)} to={`/category/${video.category}`} className="border-brand-500/30 bg-brand-500/10 text-brand-200" />
              {video.tags.slice(1).map((t) => (
                <Tag key={t} label={t} to={`/search?q=${encodeURIComponent(t)}`} />
              ))}
            </div>
            <p className={cn("mt-3 text-sm leading-relaxed text-fog-400", !expanded && "line-clamp-2")}>
              {video.description}
            </p>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-300 transition hover:text-brand-400"
            >
              {expanded ? "Show less" : "Show more"}
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
            </button>
            <div className="mt-4 flex items-center gap-2.5 border-t border-white/6 pt-3.5">
              <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-brand-500/40 to-violet-600/40 text-xs font-bold text-white">
                {video.performer.split(" ").map((w) => w[0]).join("")}
              </span>
              <div>
                <p className="text-sm font-medium text-white">{video.performer}</p>
                <p className="text-[11px] text-fog-600">Fictional demo performer</p>
              </div>
            </div>
          </Panel>
        </div>

        {/* ── Recommendations ── */}
        <aside aria-label="Recommended videos" className="min-w-0">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight text-white">
            <Flame className="size-4 text-brand-400" aria-hidden />
            Up next
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            {related.map((v) => (
              <RecoRow key={v.id} video={v} />
            ))}
          </div>
        </aside>
      </div>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} url={url} title={video.title} />
    </div>
  );
}
