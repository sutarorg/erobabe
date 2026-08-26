import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Captions, Gauge, Loader2, Maximize, Minimize,
  Pause, PictureInPicture2, Play, Volume2, VolumeX,
} from "lucide-react";
import { clamp, cn, formatDuration } from "@/lib/format";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document;

/**
 * A premium custom control surface around the native HTML5 <video> element:
 * play/pause, seek with hover timestamps & buffered hint, volume, playback
 * speed, captions, picture-in-picture, fullscreen and keyboard shortcuts.
 */
export function Player({
  src,
  poster,
  title,
  captionsUrl,
  onEnded,
}: {
  src: string;
  poster?: string;
  title?: string;
  captionsUrl?: string;
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [rateOpen, setRateOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [ccOn, setCcOn] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(true);
  const [seeking, setSeeking] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const video = () => videoRef.current;

  /* ── HLS support: native on Safari, hls.js (lazy-loaded) elsewhere ── */
  const [hlsManaged, setHlsManaged] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src || !/\.m3u8(\?|#|$)/i.test(src)) {
      setHlsManaged(false);
      return;
    }
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      setHlsManaged(false);
      return;
    }
    let destroyed = false;
    let hls: import("hls.js").default | null = null;
    import("hls.js")
      .then((mod) => {
        if (destroyed) return;
        const Hls = mod.default;
        if (Hls.isSupported()) {
          hls = new Hls({ maxBufferLength: 30, enableWorker: true });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) setError(true);
          });
          hls.loadSource(src);
          hls.attachMedia(v);
          setHlsManaged(true);
        }
      })
      .catch(() => {});
    return () => {
      destroyed = true;
      hls?.destroy();
      setHlsManaged(false);
    };
  }, [src]);

  /* ── Controls auto-hide ── */
  const poke = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const v = video();
      if (v && !v.paused) setVisible(false);
    }, 2600);
  }, []);

  /* ── Playback ── */
  const togglePlay = useCallback(() => {
    const v = video();
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekTo = (ratio: number) => {
    const v = video();
    if (!v || !v.duration) return;
    v.currentTime = clamp(ratio, 0, 1) * v.duration;
    setTime(v.currentTime);
  };

  const toggleMute = useCallback(() => {
    const v = video();
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const changeVolume = (val: number) => {
    const v = video();
    if (!v) return;
    const nv = clamp(val, 0, 1);
    v.volume = nv;
    v.muted = nv === 0;
    setVolume(nv);
    setMuted(v.muted);
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrapRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const togglePip = useCallback(() => {
    const v = video();
    if (!v) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else v.requestPictureInPicture?.().catch(() => {});
  }, []);

  const toggleCc = useCallback(() => {
    const v = video();
    if (!v || !v.textTracks.length) return;
    const track = v.textTracks[0];
    const show = track.mode !== "showing";
    track.mode = show ? "showing" : "hidden";
    setCcOn(show);
  }, []);

  /* ── Global listeners ── */
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
    };
  }, []);

  /* ── Keyboard shortcuts ── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = video();
    if (!v) return;
    const handled = new Set([" ", "k", "m", "f", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
    if (!handled.has(e.key)) return;
    e.preventDefault();
    poke();
    switch (e.key) {
      case " ":
      case "k": togglePlay(); break;
      case "m": toggleMute(); break;
      case "f": toggleFullscreen(); break;
      case "ArrowLeft": v.currentTime = Math.max(0, v.currentTime - 10); break;
      case "ArrowRight": v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); break;
      case "ArrowUp": changeVolume(v.volume + 0.1); break;
      case "ArrowDown": changeVolume(v.volume - 0.1); break;
    }
  };

  /* Single click = play/pause · double click = fullscreen */
  const onVideoClick = () => {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      toggleFullscreen();
    } else {
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null;
        togglePlay();
        poke();
      }, 240);
    }
  };

  /* ── Seek bar ── */
  const seekRatioFromEvent = (clientX: number) => {
    const bar = seekRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };

  const playedPct = duration ? (time / duration) * 100 : 0;
  const bufferedPct = duration ? clamp((buffered / duration) * 100, 0, 100) : 0;

  const ctrlBtn =
    "grid size-9 shrink-0 place-items-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white active:scale-90";

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="region"
      aria-label={title ? `Video player — ${title}` : "Video player"}
      onKeyDown={onKeyDown}
      onMouseMove={poke}
      onTouchStart={poke}
      onMouseLeave={() => {
        const v = video();
        if (v && !v.paused) setVisible(false);
      }}
      className={cn(
        "group/player relative aspect-video w-full select-none overflow-hidden bg-black ring-1 ring-white/10 focus-visible:outline-none",
        fullscreen ? "rounded-none" : "rounded-xl md:rounded-2xl",
        !visible && playing && "cursor-none"
      )}
    >
      <video
        ref={videoRef}
        src={hlsManaged ? undefined : src}
        poster={poster}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        aria-label={title}
        className="h-full w-full object-contain"
        onClick={onVideoClick}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          e.currentTarget.volume = volume;
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const v = e.currentTarget;
          const b = v.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onPlay={() => { setPlaying(true); poke(); }}
        onPause={() => { setPlaying(false); setVisible(true); }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onError={() => setError(true)}
        onEnded={() => { setVisible(true); onEnded?.(); }}
      >
        {captionsUrl && (
          <track kind="captions" src={captionsUrl} srcLang="en" label="English (demo)" />
        )}
      </video>

      {/* Buffering spinner */}
      {waiting && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <Loader2 className="size-12 animate-spin text-white/80" />
        </div>
      )}

      {/* Big center play when paused */}
      {!playing && !waiting && !error && (
        <button
          type="button"
          aria-label="Play"
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/50 text-white shadow-2xl backdrop-blur transition hover:scale-105 hover:bg-brand-500/80 active:scale-95 animate-scale-in"
        >
          <Play className="ml-1 size-9 fill-white" aria-hidden />
        </button>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-ink-950/90 p-6 text-center">
          <div>
            <AlertTriangle className="mx-auto size-10 text-brand-400" aria-hidden />
            <p className="mt-3 text-base font-semibold text-white">This video couldn't be loaded</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-fog-500">
              The placeholder demo source may be unreachable. Replace it with your own file in /public/assets/videos.
            </p>
            <button
              type="button"
              onClick={() => {
                setError(false);
                video()?.load();
              }}
              className="mt-4 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-5 py-2 text-xs font-semibold text-white transition hover:brightness-110"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Player title belongs to the top edge, independent of the bottom controls. */}
      {title && !error && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-10 h-24 transition-opacity duration-300",
            visible ? "opacity-100" : "opacity-0"
          )}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/45 to-transparent"
          />
          <p className="relative truncate px-4 pt-3.5 text-sm font-medium text-white/95 drop-shadow-md sm:px-5 sm:pt-4 sm:text-[15px]">
            {title}
          </p>
        </div>
      )}

      {/* ── Control surface ── */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 transition-opacity duration-300",
          visible ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        {/* Seek bar */}
        <div
          ref={seekRef}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatDuration(time)} of ${formatDuration(duration)}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setSeeking(true);
            seekTo(seekRatioFromEvent(e.clientX));
            poke();
          }}
          onPointerMove={(e) => {
            const r = seekRatioFromEvent(e.clientX);
            const bar = seekRef.current;
            if (bar) {
              const rect = bar.getBoundingClientRect();
              setHover({ x: clamp(e.clientX - rect.left, 0, rect.width), t: r * (duration || 0) });
            }
            if (seeking) seekTo(r);
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setSeeking(false);
          }}
          onPointerLeave={() => !seeking && setHover(null)}
          className="group/seek relative block h-6 cursor-pointer px-0"
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20 transition-all group-hover/seek:h-1.5">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${bufferedPct}%` }} />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-500 to-violet-500"
              style={{ width: `${playedPct}%` }}
            />
            <div
              className={cn(
                "absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-white shadow transition-opacity",
                seeking ? "opacity-100" : "opacity-0 group-hover/seek:opacity-100"
              )}
              style={{ left: `calc(${playedPct}% - 6px)` }}
            />
          </div>
          {hover && duration > 0 && (
            <span
              className="glass pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums text-white"
              style={{ left: hover.x }}
            >
              {formatDuration(hover.t)}
            </span>
          )}
        </div>

        {/* Control row */}
        <div className="flex h-12 items-center gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 sm:gap-1.5 sm:px-3">
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => { togglePlay(); poke(); }} className={ctrlBtn}>
            {playing ? <Pause className="size-5 fill-white" aria-hidden /> : <Play className="ml-0.5 size-5 fill-white" aria-hidden />}
          </button>

          <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute} className={ctrlBtn}>
            {muted || volume === 0 ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume"
            className="hidden h-1 w-20 cursor-pointer sm:block"
          />

          <span className="ml-1 shrink-0 text-[11px] font-medium tabular-nums text-white/80 sm:text-xs">
            {formatDuration(time)} <span className="text-white/40">/ {formatDuration(duration)}</span>
          </span>

          <span className="flex-1" />

          {/* Playback speed */}
          <div className="relative">
            <button
              type="button"
              aria-label="Playback speed"
              aria-haspopup="menu"
              aria-expanded={rateOpen}
              onClick={() => { setRateOpen((o) => !o); poke(); }}
              className={cn(ctrlBtn, "w-auto gap-1 px-2.5 text-xs font-semibold")}
            >
              <Gauge className="size-4.5" aria-hidden />
              <span className="hidden sm:inline">{rate === 1 ? "Speed" : `${rate}×`}</span>
            </button>
            {rateOpen && (
              <div role="menu" className="glass absolute bottom-full right-0 mb-2 w-32 overflow-hidden rounded-xl border border-white/10 py-1 shadow-2xl animate-scale-in">
                {RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="menuitemradio"
                    aria-checked={rate === r}
                    onClick={() => {
                      const v = video();
                      if (v) v.playbackRate = r;
                      setRate(r);
                      setRateOpen(false);
                    }}
                    className={cn(
                      "block w-full px-3.5 py-2 text-left text-xs font-medium transition",
                      rate === r ? "bg-white/10 text-brand-300" : "text-fog-300 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    {r === 1 ? "Normal" : `${r}×`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {captionsUrl && (
            <button
              type="button"
              aria-label={ccOn ? "Hide captions" : "Show captions"}
              aria-pressed={ccOn}
              onClick={toggleCc}
              className={cn(ctrlBtn, ccOn && "bg-white/15 text-brand-300")}
            >
              <Captions className="size-5" aria-hidden />
            </button>
          )}

          {pipSupported && (
            <button type="button" aria-label="Picture in picture" onClick={togglePip} className={cn(ctrlBtn, "hidden sm:grid")}>
              <PictureInPicture2 className="size-4.5" aria-hidden />
            </button>
          )}

          <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen} className={ctrlBtn}>
            {fullscreen ? <Minimize className="size-5" aria-hidden /> : <Maximize className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
