import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useUi } from "@/context/ui";
import {
  BadgeCheck, Bookmark, CalendarDays, ChevronDown, Eye, Flame, Link2, Play,
  Share2, ThumbsUp, VideoOff, X, type LucideIcon,
} from "lucide-react";
import { CAPTIONS_URL, categoryName, getVideoById, relatedVideos, type Video } from "@/data/videos";
import { trackLike, trackProgress, trackView } from "@/data/dynamic";
import { useHistory, useLikes, useSaved } from "@/hooks/store";
import { absUrl, isoDuration, siteOrigin, useSEO, SITE_DESCRIPTION } from "@/lib/seo";
import { Player } from "@/components/Player";
import { ShareModal } from "@/components/ShareModal";
import { EmptyState, Tag, VideoGrid } from "@/components/Sections";
import { toast } from "@/components/Feedback";
import { cn, formatPercent, fullDate } from "@/lib/format";

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
    <Link to={`/video/${video.id}`} className="group flex gap-3">
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

/** Desktop shows exactly four Up Next videos. */
const UP_NEXT_COUNT = 4;
/** The mobile Up Next overlay appears this many seconds before the end. */
const UP_NEXT_LEAD_SECONDS = 5;
/**
 * Related videos: 4 × 5 = 20 on desktop and 2 × 10 = 20 on mobile.
 * View More reveals anything beyond this first page.
 */
const RELATED_STEP = 20;
/** How many Up Next entries View More expands to. */
const UP_NEXT_EXPANDED = 12;

/** Shared View More / Show Less control for the expandable rails. */
function ViewMoreButton({
  expanded, onToggle, moreCount,
}: { expanded: boolean; onToggle: () => void; moreCount: number }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="mx-auto mt-6 flex h-10 items-center gap-2 rounded-full border border-white/10 bg-ink-800/80 px-6 text-xs font-semibold text-fog-200 transition hover:border-brand-500/40 hover:text-white active:scale-95"
    >
      <ChevronDown
        className={cn("size-4 transition-transform", expanded && "rotate-180")}
        aria-hidden
      />
      {expanded ? "Show Less" : `View More${moreCount > 0 ? ` (${moreCount})` : ""}`}
    </button>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/6 bg-ink-900/50 p-4 md:p-5", className)}>{children}</div>
  );
}

export default function Watch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { prefs } = useUi();
  const video = id ? getVideoById(id) : undefined;

  const history = useHistory();
  const likes = useLikes();
  const saved = useSaved();
  const [shareOpen, setShareOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Meta title mirrors the video title; description falls back to the
  // site-wide default; keywords come from the tags the admin entered.
  const watchTitle = video ? video.title : "Video unavailable — EroBabe";
  const watchDescription = video
    ? (video.description || video.seoDescription || SITE_DESCRIPTION).replace(/\s+/g, " ").slice(0, 300)
    : undefined;
  const canonical = video ? `${siteOrigin()}/video/${video.id}` : undefined;
  const uploadDate = video ? new Date(Date.now() - video.daysAgo * 86_400_000).toISOString() : undefined;

  useSEO(
    video
      ? {
          title: watchTitle,
          description: watchDescription,
          keywords: [...(video.tags ?? []), categoryName(video.category), "EroBabe", "18+ video"].filter(Boolean),
          canonical,
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
            description: (video.description || watchDescription || "").slice(0, 500),
            thumbnailUrl: [absUrl(video.thumbnail)],
            uploadDate,
            datePublished: uploadDate,
            duration: isoDuration(video.duration),
            contentUrl: absUrl(video.videoUrl),
            embedUrl: canonical,
            url: canonical,
            genre: categoryName(video.category),
            keywords: (video.tags ?? []).join(", "),
            isFamilyFriendly: false,
            inLanguage: "en",
            publisher: {
              "@type": "Organization",
              name: "EroBabe",
              url: `${siteOrigin()}/`,
            },
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
      // Track against the database id when available (slug also accepted).
      trackView(video.uuid ?? video.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  /* ── Watch-time + completion signals for the ranking engine ── */
  const watchRef = useRef({ watched: 0, completion: 0, sent: 0 });
  const trackRef = useRef<string | null>(null);
  trackRef.current = video ? video.uuid ?? video.id : null;

  const flushProgress = useCallback(() => {
    const id = trackRef.current;
    const s = watchRef.current;
    if (!id || s.watched < 3 || s.watched <= s.sent + 2) return;
    s.sent = s.watched;
    trackProgress(id, s.watched, s.completion);
  }, []);

  /* ── Mobile Up Next overlay: appears shortly before the video ends ── */
  const [showUpNext, setShowUpNext] = useState(false);
  const upNextArmed = useRef(false);
  const upNextDismissed = useRef(false);

  const handleProgress = useCallback(
    (currentTime: number, dur: number) => {
      const s = watchRef.current;
      s.watched = Math.max(s.watched, currentTime);
      if (dur > 0) s.completion = Math.min(100, (currentTime / dur) * 100);
      if (
        dur > 0 &&
        !upNextArmed.current &&
        dur - currentTime <= UP_NEXT_LEAD_SECONDS
      ) {
        upNextArmed.current = true;
        // A viewer who already closed the card shouldn't have it come back.
        if (!upNextDismissed.current) setShowUpNext(true);
      }
      // Heartbeat every ~15s of playback.
      if (s.watched - s.sent >= 15) flushProgress();
    },
    [flushProgress]
  );

  useEffect(() => {
    watchRef.current = { watched: 0, completion: 0, sent: 0 };
    upNextArmed.current = false;
    upNextDismissed.current = false;
    setShowUpNext(false);
  }, [video?.id]);

  useEffect(() => {
    const onHide = () => flushProgress();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flushProgress();
    };
  }, [flushProgress]);

  /* ── Autoplay next (Playback Preferences) ── */
  const nextRef = useRef<string | null>(null);
  const playNext = useCallback(() => {
    // A viewer who closed the Up Next card opted out of continuing.
    if (upNextDismissed.current) return;
    if (!prefs.autoplayNext || !nextRef.current) return;
    flushProgress();
    navigate(`/video/${nextRef.current}`);
  }, [prefs.autoplayNext, navigate, flushProgress]);

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
  const url = `${window.location.origin}/video/${video.id}`;
  const related = relatedVideos(video, 40);
  nextRef.current = related[0]?.id ?? null;
  const upNext = related[0];

  /* ── Expandable rails ── */
  const [relatedExpanded, setRelatedExpanded] = useState(false);
  const [upNextExpanded, setUpNextExpanded] = useState(false);
  const relatedVisible = relatedExpanded ? related : related.slice(0, RELATED_STEP);
  const upNextItems = upNextExpanded
    ? related.slice(0, UP_NEXT_EXPANDED)
    : related.slice(0, UP_NEXT_COUNT);

  useEffect(() => {
    setRelatedExpanded(false);
    setUpNextExpanded(false);
  }, [video?.id]);

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
          <div className="relative">
            <Player
              key={video.id}
              src={video.videoUrl}
              poster={video.thumbnail}
              title={video.title}
              captionsUrl={CAPTIONS_URL}
              onProgress={handleProgress}
              startMuted={prefs.muteOnStart}
              onEnded={playNext}
            />

            {/* ── Mobile Up Next overlay ──
                Appears ~5s before the end and sits clear of the control bar,
                so it never blocks play/pause or the seek bar. Dismissing it
                leaves playback completely untouched. */}
            {showUpNext && upNext && (
              <div
                role="dialog"
                aria-label="Up next video"
                className="absolute inset-x-2 bottom-24 z-30 animate-fade-up sm:inset-x-4 xl:hidden"
              >
                <div className="glass flex items-center gap-3 rounded-xl border border-white/12 p-2 pr-2 shadow-2xl">
                  <Link
                    to={`/video/${upNext.id}`}
                    onClick={flushProgress}
                    className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10 sm:w-28"
                  >
                    <img
                      src={upNext.thumbnail}
                      alt={`${upNext.title} thumbnail`}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[10px] font-semibold text-white">
                      {upNext.durationLabel}
                    </span>
                  </Link>

                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-300">Up next</p>
                    <Link
                      to={`/video/${upNext.id}`}
                      onClick={flushProgress}
                      className="line-clamp-2 text-xs font-medium leading-snug text-white transition hover:text-brand-300"
                    >
                      {upNext.title}
                    </Link>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        flushProgress();
                        playNext();
                      }}
                      aria-label="Play next video now"
                      className="grid size-8 place-items-center rounded-lg bg-gradient-to-r from-brand-500 to-violet-600 text-white transition hover:brightness-110 active:scale-90"
                    >
                      <Play className="ml-0.5 size-3.5 fill-white" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Dismissing never touches the player — it only hides
                        // the card and cancels auto-advance for this video.
                        upNextDismissed.current = true;
                        setShowUpNext(false);
                      }}
                      aria-label="Close Up Next"
                      className="grid size-8 place-items-center rounded-lg border border-white/12 bg-white/6 text-fog-300 transition hover:bg-white/12 hover:text-white active:scale-90"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

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
              {formatPercent(video.likeRatio)}% liked
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
                trackLike(video.uuid ?? video.id, !liked);
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
                <p className="text-[11px] text-fog-600">Curated creator content</p>
              </div>
            </div>
          </Panel>
        </div>

        {/* ── Up Next — desktop sidebar (mobile uses the end-of-video overlay) ── */}
        <aside aria-label="Up next videos" className="hidden min-w-0 xl:block">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight text-white">
            <Flame className="size-4 text-brand-400" aria-hidden />
            Up next
          </h2>
          <div className="grid gap-4">
            {upNextItems.map((v) => (
              <RecoRow key={v.id} video={v} />
            ))}
          </div>
          {related.length > UP_NEXT_COUNT && (
            <ViewMoreButton
              expanded={upNextExpanded}
              onToggle={() => setUpNextExpanded((e) => !e)}
              moreCount={related.length - UP_NEXT_COUNT}
            />
          )}
        </aside>
      </div>

      {/* ── Related videos ──
          Spans the full page width so the 4-column grid fills the screen
          with no dead space beside the Up Next sidebar. */}
      {related.length > 0 && (
        <section aria-label="Related videos" className="mt-10 border-t border-white/6 pt-8">
          <h2 className="mb-4 text-base font-semibold tracking-tight text-white">Related videos</h2>
          {/* Collapsed: exactly one page (4×5 desktop / 2×10 mobile).
              Expanded: everything available. */}
          <VideoGrid
            videos={relatedVisible}
            desktopCols={4}
            count={RELATED_STEP}
            showAll={relatedExpanded}
          />
          {related.length > RELATED_STEP && (
            <ViewMoreButton
              expanded={relatedExpanded}
              onToggle={() => setRelatedExpanded((e) => !e)}
              moreCount={related.length - RELATED_STEP}
            />
          )}
        </section>
      )}

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} url={url} title={video.title} />
    </div>
  );
}
