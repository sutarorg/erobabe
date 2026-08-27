/**
 * Watch page: player (native HTML5, premium wrapper), metadata, actions,
 * description, recommendations + real view-event tracking.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bookmark, Check, Eye, Film, Gauge, Heart, Link2, PictureInPicture2,
  Share2,
} from "lucide-react";
import { FALLBACK_THUMB, formatViews, timeAgo, type Video } from "../data/videos";
import { categoryName, getRelated, getSettings, getVideo, recordView } from "../lib/api";
import {
  getLikes, getSaves, pushHistory, toggleLike, toggleSave,
  useDocumentTitle, useStoreVersion,
} from "../lib/store";
import { ShareModal, Thumb } from "../components/video";
import { Badge, Button, EmptyState } from "../components/ui";
import { cn } from "../utils/cn";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function WatchPage() {
  const { id = "" } = useParams();
  const [video, setVideo] = useState<Video | null | undefined>(undefined);
  const [related, setRelated] = useState<Video[]>([]);
  useDocumentTitle(video ? video.title : "Watch");

  useEffect(() => {
    let live = true;
    setVideo(undefined);
    setRelated([]);
    getVideo(id).then((v) => {
      if (!live) return;
      setVideo(v ?? null);
      if (v) getRelated(v, 14).then((r) => live && setRelated(r));
    });
    return () => {
      live = false;
    };
  }, [id]);

  if (video === undefined) return <WatchSkeleton />;
  if (video === null)
    return (
      <EmptyState
        icon={<Film size={26} />}
        title="Video unavailable"
        body="This video doesn't exist, was removed, or hasn't been published yet."
        action={
          <Link to="/">
            <Button>Browse videos</Button>
          </Link>
        }
      />
    );

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <Player key={video.id} video={video} />
        <VideoMeta video={video} />
        <Description video={video} />
      </div>
      <aside aria-label="Recommended videos" className="min-w-0">
        <h2 className="font-display mb-4 text-base font-bold text-white">Up next</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {related.slice(0, 12).map((v) => (
            <RecommendedRow key={v.id} video={v} />
          ))}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

function Player({ video }: { video: Video }) {
  const ref = useRef<HTMLVideoElement>(null);
  const watched = useRef(0);
  const lastTick = useRef(0);
  const counted = useRef(false);
  const historyPushed = useRef(false);
  const [speed, setSpeed] = useState(1);
  const settings = getSettings();

  useEffect(() => {
    watched.current = 0;
    lastTick.current = 0;
    counted.current = false;
    historyPushed.current = false;
  }, [video.id]);

  const onTime = () => {
    const el = ref.current;
    if (!el || el.paused) return;
    if (lastTick.current) watched.current += Math.max(0, el.currentTime - lastTick.current);
    lastTick.current = el.currentTime;
    if (!historyPushed.current && watched.current >= 2) {
      historyPushed.current = true;
      pushHistory(video.id);
    }
    if (!counted.current && watched.current >= settings.viewThresholdSec) {
      counted.current = true;
      void recordView(video.id, watched.current);
    }
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (ref.current) ref.current.playbackRate = next;
  };

  const pip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (ref.current && document.pictureInPictureEnabled) await ref.current.requestPictureInPicture();
    } catch {
      /* unsupported */
    }
  };

  const hasSource = Boolean(video.videoUrl);

  return (
    <div className="group/player relative overflow-hidden rounded-2xl border border-eb-line bg-black shadow-2xl shadow-black/60">
      <div className="aspect-video">
        {hasSource ? (
          <video
            ref={ref}
            src={video.videoUrl}
            poster={video.thumbnail || FALLBACK_THUMB}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={onTime}
            onPause={() => (lastTick.current = 0)}
            onEnded={() => {
              lastTick.current = 0;
            }}
            className="h-full w-full"
            aria-label={video.title}
          />
        ) : (
          <div className="relative flex h-full items-center justify-center">
            <img src={video.thumbnail || FALLBACK_THUMB} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 blur-sm" />
            <div className="relative max-w-sm px-6 text-center">
              <Film size={28} className="mx-auto mb-3 text-eb-rose" />
              <p className="text-sm font-semibold text-white">Stream source not available</p>
              <p className="mt-1.5 text-xs leading-relaxed text-eb-muted">
                This demo upload's file reference expired (browser uploads are session-only). Replace the file in the admin to restore playback.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* top overlay bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover/player:opacity-100">
        <p className="truncate text-xs font-semibold text-white/90">{video.title}</p>
        <Badge className="bg-eb-rose/90">{video.quality}</Badge>
      </div>

      {/* custom accessory controls */}
      {hasSource && (
        <div className="flex items-center gap-2 border-t border-eb-line bg-eb-900/80 px-3 py-2">
          <button onClick={cycleSpeed} className="ring-focus flex cursor-pointer items-center gap-1.5 rounded-full border border-eb-line px-3 py-1.5 text-[11px] font-semibold text-eb-muted transition hover:border-white/25 hover:text-white">
            <Gauge size={12} /> {speed}×
          </button>
          {document.pictureInPictureEnabled && (
            <button onClick={pip} className="ring-focus flex cursor-pointer items-center gap-1.5 rounded-full border border-eb-line px-3 py-1.5 text-[11px] font-semibold text-eb-muted transition hover:border-white/25 hover:text-white">
              <PictureInPicture2 size={12} /> Mini player
            </button>
          )}
          <span className="ml-auto text-[10px] text-eb-faint">Single-source MP4 • adaptive HLS served when processing is configured</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meta + actions                                                      */
/* ------------------------------------------------------------------ */

function VideoMeta({ video }: { video: Video }) {
  useStoreVersion();
  const liked = getLikes().includes(video.id);
  const saved = getSaves().includes(video.id);
  const [share, setShare] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* unavailable */
    }
  };

  return (
    <div className="mt-4">
      <h1 className="font-display text-lg leading-snug font-bold text-white sm:text-2xl">{video.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-eb-muted">
        <span className="inline-flex items-center gap-1.5">
          <Eye size={13} /> {formatViews(video.views)} views
        </span>
        <span>•</span>
        <span>{timeAgo(video.daysAgo)}</span>
        <span>•</span>
        <Link to={`/category/${video.category}`} className="ring-focus rounded font-semibold text-eb-rose-soft hover:text-eb-rose">
          {categoryName(video.category)}
        </Link>
        <span>•</span>
        <span className="text-eb-faint">{video.performer}</span>
      </div>

      <div className="no-scrollbar -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
        <ActionButton active={liked} onClick={() => toggleLike(video.id)} icon={<Heart size={15} className={liked ? "fill-eb-rose text-eb-rose" : ""} />} label={liked ? "Liked" : "Like"} />
        <ActionButton onClick={() => setShare(true)} icon={<Share2 size={15} />} label="Share" />
        <ActionButton active={saved} onClick={() => toggleSave(video.id)} icon={<Bookmark size={15} className={saved ? "fill-eb-violet text-eb-violet" : ""} />} label={saved ? "Saved" : "Save"} />
        <ActionButton onClick={copy} icon={copied ? <Check size={15} className="text-emerald-400" /> : <Link2 size={15} />} label={copied ? "Copied!" : "Copy link"} />
      </div>

      {/* tags */}
      <div className="no-scrollbar -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
        {[categoryName(video.category), ...video.tags].map((t) => (
          <Link
            key={t}
            to={`/search?q=${encodeURIComponent(t)}`}
            className="ring-focus shrink-0 rounded-full border border-eb-line bg-eb-850 px-3 py-1 text-[11px] font-medium text-eb-muted transition hover:border-eb-rose/40 hover:text-white"
          >
            #{t}
          </Link>
        ))}
      </div>

      <ShareModal video={video} open={share} onClose={() => setShare(false)} />
    </div>
  );
}

function ActionButton({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "ring-focus flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-xs font-semibold transition",
        active ? "border-transparent bg-gradient-to-r from-eb-rose/20 to-eb-violet/20 text-white" : "border-eb-line bg-eb-850 text-eb-muted hover:border-white/25 hover:text-white"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Description({ video }: { video: Video }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="ring-focus mt-4 block w-full cursor-pointer rounded-2xl border border-eb-line bg-eb-900/60 p-4 text-left transition hover:bg-eb-900"
    >
      <p className={cn("text-sm leading-relaxed text-eb-muted", !open && "line-clamp-2 sm:line-clamp-3")}>
        {video.description}
        {video.studio && <span className="mt-2 block text-xs text-eb-faint">Produced by {video.studio}. All performers featured in EroBabe demo content are fictional.</span>}
      </p>
      <span className="mt-2 inline-block text-xs font-semibold text-eb-rose-soft">{open ? "Show less" : "Show more"}</span>
    </button>
  );
}

function RecommendedRow({ video }: { video: Video }) {
  return (
    <Link to={`/watch/${video.id}`} className="group ring-focus flex gap-3 rounded-xl p-1 transition hover:bg-white/[0.03]">
      <Thumb video={video} className="w-36 shrink-0 sm:w-40" />
      <div className="min-w-0 py-0.5">
        <h3 className="line-clamp-2 text-[13px] leading-snug font-semibold text-eb-text group-hover:text-white">{video.title}</h3>
        <p className="mt-1 truncate text-[11px] text-eb-faint">
          {formatViews(video.views)} views • {timeAgo(video.daysAgo)}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-eb-rose-soft/90">{categoryName(video.category)}</p>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */

function WatchSkeleton() {
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        <div className="skeleton aspect-video rounded-2xl" />
        <div className="skeleton mt-4 h-6 w-3/4 rounded" />
        <div className="skeleton mt-3 h-4 w-1/2 rounded" />
        <div className="skeleton mt-6 h-20 rounded-2xl" />
      </div>
      <div className="hidden space-y-3 xl:block">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton aspect-video w-36 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2 py-1">
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
