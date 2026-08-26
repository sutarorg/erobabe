import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Captions, Gauge, Loader2, Maximize, Minimize,
  Pause, PictureInPicture2, Play, Volume2, VolumeX,
} from "lucide-react";
import { clamp, cn, formatDuration } from "@/lib/format";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document;
const isHls = (src: string) => /\.m3u8(\?|#|$)/i.test(src);

/**
 * Premium control surface around the native HTML5 <video> element.
 *
 *  · Tap / click anywhere on the video smoothly fades the whole HUD
 *    (title, scrims, seek bar, buttons) out and back in.
 *  · The seek bar is a pointer-captured slider that works identically
 *    for mouse drag and touch swipe, with a live preview frame rendered
 *    above the bar and the real seek committed on release.
 *  · Fullscreen uses the browser's native behaviour — no custom overlays,
 *    toasts or "press Esc to exit" messaging of any kind.
 */
export function Player({
  src,
  poster,
  title,
  captionsUrl,
  onEnded,
  onProgress,
}: {
  src: string;
  poster?: string;
  title?: string;
  captionsUrl?: string;
  onEnded?: () => void;
  /** Playback heartbeat used for watch-time / completion analytics. */
  onProgress?: (currentTime: number, duration: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);

  const hideTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);
  const previewRaf = useRef<number | null>(null);
  const lastPointerType = useRef<string>("mouse");
  const resumeAfterScrub = useRef(false);
  /** Set when the viewer deliberately hides the HUD, so mouse-move won't fight them. */
  const hudLocked = useRef(false);

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
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [preview, setPreview] = useState<{ x: number; t: number; barW: number } | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  /** Preview card width — kept in JS so edge clamping is pixel-exact. */
  const [previewW, setPreviewW] = useState(160);

  const video = () => videoRef.current;
  const canPreviewFrames = Boolean(src) && !isHls(src);

  /* ── HLS: native on Safari, hls.js (lazy) elsewhere ── */
  const [hlsManaged, setHlsManaged] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src || !isHls(src)) {
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

  /* ── HUD visibility ── */
  const clearHideTimer = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  /** Reveal the HUD and restart the idle countdown. */
  const poke = useCallback(() => {
    hudLocked.current = false;
    setVisible(true);
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !scrubbing && !rateOpen) setVisible(false);
    }, 2800);
  }, [scrubbing, rateOpen]);

  /** Explicit tap/click toggle — the HUD fades out and stays out until asked back. */
  const toggleHud = useCallback(() => {
    setVisible((wasVisible) => {
      const next = !wasVisible;
      hudLocked.current = !next;
      clearHideTimer();
      if (next) {
        hideTimer.current = window.setTimeout(() => {
          const v = videoRef.current;
          if (v && !v.paused && !scrubbing && !rateOpen) setVisible(false);
        }, 2800);
      }
      return next;
    });
  }, [scrubbing, rateOpen]);

  /* ── Playback ── */
  const togglePlay = useCallback(() => {
    const v = video();
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

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
    // Native fullscreen only — the browser owns any exit messaging.
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

  /* Preview card is 128px on small screens, 160px from `sm` upwards. */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setPreviewW(mq.matches ? 160 : 128);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      clearHideTimer();
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
      if (previewRaf.current) cancelAnimationFrame(previewRaf.current);
    };
  }, []);

  /* ── Keyboard ── */
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

  /* Tap/click = fade the HUD · double-click (mouse) = fullscreen */
  const onSurfaceClick = () => {
    if (lastPointerType.current === "touch") {
      toggleHud();
      return;
    }
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      toggleFullscreen();
      return;
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      toggleHud();
    }, 220);
  };

  /* ── Seek bar ── */
  const ratioFromClientX = (clientX: number) => {
    const bar = seekRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };

  /** Move the preview frame + bubble (throttled to one seek per frame). */
  const updatePreview = (clientX: number, ratio: number) => {
    const bar = seekRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const t = ratio * duration;
    setPreview({ x: clamp(clientX - rect.left, 0, rect.width), t, barW: rect.width });

    if (!canPreviewFrames) return;
    if (previewRaf.current) cancelAnimationFrame(previewRaf.current);
    previewRaf.current = requestAnimationFrame(() => {
      const pv = previewRef.current;
      if (pv && Number.isFinite(t)) {
        try {
          pv.currentTime = t;
        } catch {
          /* seeking before metadata is ready — ignored */
        }
      }
    });
  };

  const beginScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = video();
    resumeAfterScrub.current = Boolean(v && !v.paused);
    v?.pause(); // pausing while dragging keeps the scrub perfectly smooth
    const ratio = ratioFromClientX(e.clientX);
    setScrubbing(true);
    setScrubTime(ratio * duration);
    updatePreview(e.clientX, ratio);
    clearHideTimer();
    setVisible(true);
    hudLocked.current = false;
  };

  const moveScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const ratio = ratioFromClientX(e.clientX);
    if (scrubbing) setScrubTime(ratio * duration);
    updatePreview(e.clientX, ratio);
  };

  /** Commit the seek exactly where the pointer was released, then resume. */
  const endScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    const ratio = ratioFromClientX(e.clientX);
    const target = ratio * duration;
    const v = video();
    setScrubbing(false);
    setPreview(null);
    if (v && Number.isFinite(target)) {
      v.currentTime = target;
      setTime(target);
      if (resumeAfterScrub.current) v.play().catch(() => {});
    }
    resumeAfterScrub.current = false;
    poke();
  };

  const displayTime = scrubbing ? scrubTime : time;
  const playedPct = duration ? clamp((displayTime / duration) * 100, 0, 100) : 0;
  const bufferedPct = duration ? clamp((buffered / duration) * 100, 0, 100) : 0;

  const ctrlBtn =
    "grid size-9 shrink-0 place-items-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white active:scale-90";

  const hudClass = (extra?: string) =>
    cn(
      "transition-opacity duration-300 ease-out",
      visible ? "opacity-100" : "pointer-events-none opacity-0",
      extra
    );

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="region"
      aria-label={title ? `Video player — ${title}` : "Video player"}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        lastPointerType.current = e.pointerType || "mouse";
      }}
      onMouseMove={() => {
        // Respect a deliberate hide; otherwise reveal on movement (desktop habit).
        if (!hudLocked.current && lastPointerType.current !== "touch") poke();
      }}
      onMouseLeave={() => {
        const v = video();
        if (v && !v.paused && !scrubbing) setVisible(false);
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
        onClick={onSurfaceClick}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          e.currentTarget.volume = volume;
        }}
        onTimeUpdate={(e) => {
          if (!scrubbing) setTime(e.currentTarget.currentTime);
          onProgress?.(e.currentTarget.currentTime, e.currentTarget.duration || 0);
        }}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onPlay={() => { setPlaying(true); poke(); }}
        onPause={() => { setPlaying(false); if (!scrubbing) { hudLocked.current = false; setVisible(true); } }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onError={() => setError(true)}
        onEnded={() => { hudLocked.current = false; setVisible(true); onEnded?.(); }}
      >
        {captionsUrl && <track kind="captions" src={captionsUrl} srcLang="en" label="English" />}
      </video>

      {waiting && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <Loader2 className="size-12 animate-spin text-white/80" />
        </div>
      )}

      {/* Center play button — part of the HUD, so it fades with everything else */}
      {!playing && !waiting && !error && (
        <button
          type="button"
          aria-label="Play"
          onClick={togglePlay}
          className={hudClass(
            "absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/50 text-white shadow-2xl backdrop-blur hover:scale-105 hover:bg-brand-500/80 active:scale-95"
          )}
        >
          <Play className="ml-1 size-9 fill-white" aria-hidden />
        </button>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-ink-950/90 p-6 text-center">
          <div>
            <AlertTriangle className="mx-auto size-10 text-brand-400" aria-hidden />
            <p className="mt-3 text-base font-semibold text-white">This video couldn't be loaded</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-fog-500">
              The media source may be temporarily unavailable. Please try again.
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

      {/* Title HUD, pinned to the top edge */}
      {title && !error && (
        <div className={hudClass("pointer-events-none absolute inset-x-0 top-0 z-10 h-24")}>
          <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/45 to-transparent" />
          <p className="relative truncate px-4 pt-3.5 text-sm font-medium text-white/95 drop-shadow-md sm:px-5 sm:pt-4 sm:text-[15px]">
            {title}
          </p>
        </div>
      )}

      {/* Bottom HUD: seek bar + controls */}
      <div className={hudClass("absolute inset-x-0 bottom-0 z-10")}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 -top-16 bg-gradient-to-t from-black/90 via-black/45 to-transparent"
        />

        {/* Seek bar — generous hit area, works for mouse drag and touch swipe */}
        <div
          ref={seekRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(displayTime)}
          aria-valuetext={`${formatDuration(displayTime)} of ${formatDuration(duration)}`}
          onPointerDown={beginScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onPointerLeave={() => !scrubbing && setPreview(null)}
          onKeyDown={(e) => {
            const v = video();
            if (!v || !duration) return;
            if (e.key === "ArrowLeft") { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
            if (e.key === "ArrowRight") { e.preventDefault(); v.currentTime = Math.min(duration, v.currentTime + 5); }
          }}
          className="group/seek relative mx-3 block cursor-pointer py-3 sm:mx-4"
          style={{ touchAction: "none" }}
        >
          <div
            className={cn(
              "relative rounded-full bg-white/25 transition-all duration-150",
              scrubbing ? "h-1.5" : "h-1 group-hover/seek:h-1.5"
            )}
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-500 to-violet-500",
                !scrubbing && "transition-[width] duration-150 ease-linear"
              )}
              style={{ width: `${playedPct}%` }}
            />
            {/* Handle: centred with a transform so its position is exact at
                0% and 100%, and never animated so it tracks the finger 1:1. */}
            <div
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg",
                "transition-[width,height,opacity] duration-150",
                scrubbing ? "size-4 opacity-100" : "size-3.5 opacity-0 group-hover/seek:opacity-100"
              )}
              style={{ left: `${playedPct}%` }}
            />
          </div>

          {/* Live preview frame above the bar — always mounted so the
              decoder is warm, faded in only while hovering/scrubbing. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute bottom-full z-20 mb-2.5 transition-opacity duration-150",
              preview && duration > 0 ? "opacity-100" : "opacity-0"
            )}
            style={{
              // Clamp against the real card width so the 16:9 frame keeps its
              // exact size at both ends of the bar instead of being squeezed.
              left: clamp(
                preview?.x ?? 0,
                previewW / 2,
                Math.max(previewW / 2, (preview?.barW ?? previewW) - previewW / 2)
              ),
              transform: "translateX(-50%)",
              width: previewW,
              visibility: preview && duration > 0 ? "visible" : "hidden",
            }}
          >
            {canPreviewFrames && (
              <div className="aspect-video w-full overflow-hidden rounded-lg border border-white/20 bg-black shadow-2xl">
                <video
                  ref={previewRef}
                  src={src}
                  muted
                  playsInline
                  preload="metadata"
                  crossOrigin="anonymous"
                  tabIndex={-1}
                  controls={false}
                  disablePictureInPicture
                  disableRemotePlayback
                  className="eb-no-media-ui block h-full w-full object-cover transition-opacity duration-150"
                  style={{ opacity: previewReady ? 1 : 0.25 }}
                  onLoadedData={() => setPreviewReady(true)}
                />
              </div>
            )}
            <p className="mx-auto mt-1 w-fit rounded-md bg-black/85 px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums text-white shadow">
              {formatDuration(preview?.t ?? 0)}
            </p>
          </div>
        </div>

        {/* Control row */}
        <div className="relative flex h-12 items-center gap-1 px-2 sm:gap-1.5 sm:px-3">
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

          <span className="ml-1 shrink-0 text-[11px] font-medium tabular-nums text-white/85 sm:text-xs">
            {formatDuration(displayTime)} <span className="text-white/45">/ {formatDuration(duration)}</span>
          </span>

          <span className="flex-1" />

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
                      poke();
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
