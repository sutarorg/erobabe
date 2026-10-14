"use client";

import {
  Check, Maximize2, Minimize2, Pause, PictureInPicture2, Play, RotateCcw, Settings, Volume1, Volume2, VolumeX,
} from "lucide-react";
import {
  useCallback, useEffect, useRef, useState,
  type ComponentProps, type FocusEvent, type KeyboardEvent, type RefObject, type SyntheticEvent,
} from "react";
import { selectPlaybackSource } from "@/lib/video/playback";
import { cn } from "@/src/utils/cn";

type Props = {
  id: string;
  title: string;
  poster?: string | null;
  playableUrl?: string | null;
  embedUrl?: string | null;
  /** Catalogue duration, shown until the media's own metadata arrives. */
  durationSeconds?: number | null;
  /** Badge such as "HD" or "4K", shown on the cover like on the video cards. */
  quality?: string | null;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_CONTROLS_MS = 2500;
const VOLUME_KEY = "erobabe:player-volume";
/** `HTMLMediaElement.HAVE_FUTURE_DATA`: enough is buffered to start playing. */
const HAVE_FUTURE_DATA = 3;

/** Where the page's inline script records the relay links it already asked to prepare. */
const EARLY_PREPARE_KEY = "__erobabePrepared";
type EarlyPrepareWindow = Window & { [EARLY_PREPARE_KEY]?: Record<string, number> };

/**
 * Inline script rendered with the player's HTML: it asks the relay to prepare
 * its link while the page is still being parsed, before the JavaScript bundle
 * has downloaded and hydrated. On a full page load that starts Streamtape's
 * ~10 s ticket wait earlier than the player's mount effect could: 0.4–0.8 s
 * in throttled phone tests (more on slow networks), ~0.1 s on desktop.
 *
 * Client-side navigations never execute it (React inserts inert `<script>`
 * elements), so the player's effect still covers those; the marker it leaves
 * keeps the two from sending the same request twice.
 */
export function earlyPrepareScript(src: string): string {
  // JSON string literal with `<` escaped, so the URL can never close the tag.
  const url = JSON.stringify(src).replace(/</g, "\\u003c");
  // The marker is set only once the request is on its way, so if `fetch` throws
  // the player's effect still sends it.
  return (
    `(function(){try{var w=window,u=${url},p=w.${EARLY_PREPARE_KEY}||(w.${EARLY_PREPARE_KEY}={});if(p[u])return;` +
    `fetch(u,{method:"POST",cache:"no-store",credentials:"same-origin"}).catch(function(){});p[u]=Date.now()}catch(e){}})();`
  );
}

/** `75` → `1:15`, `3725` → `1:02:05`. */
export function formatClock(value: number): string {
  const total = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const percent = (value: number, total: number) => `${total > 0 ? clamp((value / total) * 100, 0, 100) : 0}%`;

/** Android Chrome: a landscape video fills the screen in landscape. */
function lockLandscape(video: HTMLVideoElement | null) {
  if (!video || video.videoWidth <= video.videoHeight || typeof screen === "undefined") return;
  const orientation = screen.orientation as unknown as { lock?: (type: string) => Promise<void> } | undefined;
  orientation?.lock?.("landscape").catch(() => undefined);
}

function ControlButton({ label, className, children, ...rest }: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-200 transition-colors hover:bg-white/10 hover:text-white",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Accent progress bar from the site design: buffered range, scrubbing and a time bubble. */
function SeekBar({ time, duration, buffered, scrubbing, animate, onScrub, onSeek, className }: {
  time: number;
  duration: number;
  buffered: number;
  scrubbing: boolean;
  animate: boolean;
  onScrub: (seconds: number | null) => void;
  onSeek: (seconds: number) => void;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const ready = duration > 0;
  const bubble = hover ?? (scrubbing ? time : null);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return time;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    const target = event.key in steps ? time + steps[event.key] : event.key === "Home" ? 0 : event.key === "End" ? duration : null;
    if (target === null || !ready) return;
    event.preventDefault();
    event.stopPropagation();
    onSeek(target);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration)}
      aria-valuenow={Math.floor(time)}
      aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
      aria-disabled={ready ? undefined : true}
      className={cn("group/seek relative flex h-6 cursor-pointer touch-none items-center", className)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (!ready || (event.pointerType === "mouse" && event.button !== 0)) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onScrub(timeAt(event.clientX));
      }}
      onPointerMove={(event) => {
        if (!ready) return;
        if ((event.pointerType || "mouse") === "mouse") setHover(timeAt(event.clientX));
        if (scrubbing) onScrub(timeAt(event.clientX));
      }}
      onPointerUp={(event) => {
        if (!scrubbing) return;
        onSeek(timeAt(event.clientX));
        onScrub(null);
      }}
      onPointerCancel={() => onScrub(null)}
      onPointerLeave={() => setHover(null)}
    >
      <div
        ref={trackRef}
        className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover/seek:h-1.5"
      >
        <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: percent(buffered, duration) }} />
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full bg-accent", animate && "transition-[width] duration-300 ease-linear")}
          style={{ width: percent(time, duration) }}
        />
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_4px_rgba(245,22,85,0.25)] transition-[scale] duration-150",
          scrubbing ? "scale-100" : "scale-0 group-hover/seek:scale-100 group-focus-visible/seek:scale-100 [@media(hover:none)]:scale-100",
          animate && "transition-[left,scale] duration-300 ease-linear",
        )}
        style={{ left: percent(time, duration) }}
      />
      {bubble !== null && ready && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-white"
          style={{ left: percent(bubble, duration) }}
        >
          {formatClock(bubble)}
        </span>
      )}
    </div>
  );
}

function VolumeSlider({ value, onChange }: { value: number; onChange: (level: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const levelAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return value;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="flex h-8 w-[72px] cursor-pointer touch-none items-center px-2"
      onKeyDown={(event) => {
        const steps: Record<string, number> = { ArrowLeft: -0.1, ArrowDown: -0.1, ArrowRight: 0.1, ArrowUp: 0.1 };
        const next = event.key in steps ? value + steps[event.key] : event.key === "Home" ? 0 : event.key === "End" ? 1 : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(next);
      }}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onChange(levelAt(event.clientX));
      }}
      onPointerMove={(event) => { if (dragging.current) onChange(levelAt(event.clientX)); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <div ref={trackRef} className="relative h-1 w-full rounded-full bg-white/25">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${value * 100}%` }} />
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{ left: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

function SpeedMenu({ rate, onSelect, onClose, menuRef }: {
  rate: number;
  onSelect: (speed: number) => void;
  onClose: (restoreFocus: boolean) => void;
  menuRef: RefObject<HTMLDivElement | null>;
}) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    // Focus the current speed so the arrow keys work straight away.
    const index = SPEEDS.indexOf(rate);
    items.current[index >= 0 ? index : SPEEDS.indexOf(1)]?.focus({ preventScroll: true });
    // Only when the menu opens, not on every speed change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.current.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = (current + (event.key === "ArrowDown" ? 1 : -1) + SPEEDS.length) % SPEEDS.length;
      items.current[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      items.current[event.key === "Home" ? 0 : SPEEDS.length - 1]?.focus();
    } else if (event.key === "Escape") {
      onClose(true);
    } else if (event.key === "Tab") {
      onClose(false);
      return;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Playback speed"
      className="eb-panel absolute bottom-[4.75rem] right-2 z-20 max-h-[calc(100%-5.5rem)] min-w-[136px] overflow-y-auto rounded-lg border border-line bg-panel/95 py-1 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur @lg:bottom-12 @lg:max-h-[calc(100%-3.75rem)]"
      onKeyDown={onKeyDown}
    >
      <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">Speed</p>
      {SPEEDS.map((speed, index) => (
        <button
          key={speed}
          ref={(node) => { items.current[index] = node; }}
          type="button"
          role="menuitemradio"
          aria-checked={rate === speed}
          onClick={() => onSelect(speed)}
          className={cn(
            "flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-white/5",
            rate === speed ? "font-semibold text-ink" : "text-ink-2 hover:text-ink",
          )}
        >
          {speed === 1 ? "Normal" : `${speed}×`}
          {rate === speed && <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

/**
 * The site's own player: native media decoding (never a provider's ad
 * player) with Erobabe controls on top.
 *
 * It is built to start instantly: the `<video>` element exists from the first
 * paint, so the browser can fetch metadata and the first frame before Play is
 * pressed (direct files at once, relayed media as soon as the visitor shows
 * intent), and Play acts on an element that is ready instead of creating one
 * and waiting for it.
 */
function SitePlayer({ src, title, poster, durationSeconds, quality, relayed = false }: {
  src: string;
  title: string;
  poster?: string | null;
  durationSeconds?: number | null;
  quality?: string | null;
  /**
   * Bytes come through this site's relay (legacy Streamtape). The server-side
   * link is prepared as soon as the page is parsed (see `earlyPrepareScript`)
   * or, after a client-side navigation, when the player mounts; media bytes
   * are fetched only once the visitor shows intent (pointer, focus or Play),
   * so a page view that never plays costs no video bandwidth.
   */
  relayed?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerKind = useRef("mouse");
  const resumeAt = useRef<number | null>(null);
  const swallowClick = useRef(false);
  const usingKeyboard = useRef(false);

  const [preload, setPreload] = useState<"none" | "metadata" | "auto">(relayed ? "none" : "metadata");
  const [started, setStarted] = useState(false); // Play was pressed
  const [rendered, setRendered] = useState(false); // a video frame is on screen
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(() => (durationSeconds && durationSeconds > 0 ? durationSeconds : 0));
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [active, setActive] = useState(false); // recent pointer or keyboard activity
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null); // preview position while dragging

  // Prepare the relay's provider link now, while the visitor is still reading:
  // Streamtape makes every new link wait ~10 s before it is issued.
  useEffect(() => {
    if (!relayed) return;
    const early = (window as EarlyPrepareWindow)[EARLY_PREPARE_KEY];
    if (early?.[src]) {
      // The server-rendered page already asked (see `earlyPrepareScript`).
      // Consume the marker so a later visit to this video in the tab asks again.
      delete early[src];
      return;
    }
    fetch(src, { method: "POST", cache: "no-store", credentials: "same-origin" }).catch(() => undefined);
  }, [relayed, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Media events that fired before hydration never reached React.
    if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    if (video.error) setFailed(true);
    try {
      const saved = JSON.parse(window.localStorage.getItem(VOLUME_KEY) || "null");
      if (typeof saved?.volume === "number") video.volume = clamp(saved.volume, 0, 1);
      if (typeof saved?.muted === "boolean") video.muted = saved.muted;
    } catch {
      // Storage can be unavailable (private browsing, blocked site data).
    }
    setVolume(video.volume);
    setMuted(video.muted);
    setPipSupported(Boolean(document.pictureInPictureEnabled) && typeof video.requestPictureInPicture === "function");
  }, []);

  useEffect(() => {
    const sync = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      setFullscreen((document.fullscreenElement ?? doc.webkitFullscreenElement ?? null) === rootRef.current);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // Keep the controls up while a keyboard user is inside them (focus must stay
  // visible), but let them hide after a mouse click left a button focused.
  useEffect(() => {
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow")) usingKeyboard.current = true;
    };
    const pointer = () => { usingKeyboard.current = false; };
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("pointerdown", pointer, true);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || settingsRef.current?.contains(target)) return;
      // Dismissing the menu by clicking the picture must not also pause it.
      swallowClick.current = target === surfaceRef.current;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const poke = useCallback(() => {
    setActive(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), HIDE_CONTROLS_MS);
  }, []);

  /** A pointer over the player or focus inside it: fetch enough to start at once. */
  const warm = useCallback(() => setPreload(relayed ? "metadata" : "auto"), [relayed]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setStarted(true);
    setEnded(false);
    warm();
    if (video.readyState < HAVE_FUTURE_DATA) setWaiting(true);
    poke();
    const attempt = video.play() as Promise<void> | undefined;
    attempt?.catch?.((error: unknown) => {
      const name = (error as { name?: string } | null)?.name;
      if (name === "AbortError") return; // superseded by pause()/load(); later media events settle the UI
      setWaiting(false);
      if (name === "NotAllowedError") setStarted(video.currentTime > 0); // the browser wants another tap
    });
  }, [poke, warm]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) play();
    else video.pause();
  }, [play]);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const end = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    const target = clamp(seconds, 0, end || 0);
    video.currentTime = target;
    setTime(target);
    if (target < end) setEnded(false);
    poke();
  }, [duration, poke]);

  const seekBy = useCallback((delta: number) => seekTo((videoRef.current?.currentTime ?? 0) + delta), [seekTo]);

  const setLevel = useCallback((level: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = clamp(Math.round(level * 100) / 100, 0, 1);
    video.volume = next;
    video.muted = next === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = 0.5;
      video.muted = false;
    } else {
      video.muted = true;
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
    } else if (root?.requestFullscreen) {
      root.requestFullscreen().then(() => lockLandscape(video)).catch(() => video?.webkitEnterFullscreen?.());
    } else if (root?.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    } else {
      video?.webkitEnterFullscreen?.(); // iPhone: only the video element itself can go full screen
    }
  }, []);

  const togglePip = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => undefined);
    else video.requestPictureInPicture().catch(() => undefined);
  }, []);

  const retry = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    resumeAt.current = video.currentTime > 0 ? video.currentTime : null;
    setFailed(false);
    // A brand-new media request: the relay resolves a fresh link if the old one failed.
    video.load();
    play();
  }, [play]);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) settingsRef.current?.focus();
  }, []);

  const syncBuffered = (video: HTMLVideoElement) => {
    const ranges = video.buffered;
    let end = 0;
    for (let index = 0; index < (ranges?.length ?? 0); index++) {
      if (ranges.start(index) <= video.currentTime + 0.5) end = Math.max(end, ranges.end(index));
    }
    setBuffered(end);
  };

  const syncDuration = (event: SyntheticEvent<HTMLVideoElement>) => {
    const value = event.currentTarget.duration;
    if (Number.isFinite(value) && value > 0) setDuration(value);
  };

  const onSurfaceClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (failed) return;
    if (pointerKind.current !== "mouse" && started && !paused && !ended) {
      // Touch: a tap shows or hides the controls; pausing uses the pause button.
      if (active) {
        clearTimeout(hideTimer.current);
        setActive(false);
      } else {
        poke();
      }
      return;
    }
    togglePlay();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    let handled = true;
    switch (event.key) {
      case " ":
        if (target.tagName === "BUTTON") return; // Space activates the focused button itself
        togglePlay();
        break;
      case "k": case "K": togglePlay(); break;
      case "ArrowLeft": seekBy(-5); break;
      case "ArrowRight": seekBy(5); break;
      case "j": case "J": seekBy(-10); break;
      case "l": case "L": seekBy(10); break;
      case "ArrowUp": setLevel(volume + 0.1); break;
      case "ArrowDown": setLevel(volume - 0.1); break;
      case "m": case "M": toggleMute(); break;
      case "f": case "F": toggleFullscreen(); break;
      case "Home": seekTo(0); break;
      case "End": seekTo(duration); break;
      default:
        if (/^[0-9]$/.test(event.key) && duration > 0) seekTo((duration * Number(event.key)) / 10);
        else handled = false;
    }
    if (handled) {
      event.preventDefault();
      poke();
    }
  };

  const busy = started && !failed && !ended && (waiting || seeking);
  const controlsShown = !failed && (!started || paused || ended || active || keyboardFocus || menuOpen || scrub !== null);
  const showPlayButton = !failed && !busy && scrub === null && (!started || paused || ended);
  const shownTime = scrub ?? time;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={`Video player: ${title}`}
      tabIndex={-1}
      className={cn("@container absolute inset-0 select-none overflow-hidden bg-black", started && !controlsShown && "cursor-none")}
      onPointerEnter={warm}
      onPointerDown={(event) => { pointerKind.current = event.pointerType || "mouse"; warm(); }}
      onPointerMove={(event) => {
        pointerKind.current = event.pointerType || "mouse";
        if (pointerKind.current === "mouse") poke();
      }}
      onPointerLeave={(event) => {
        if ((event.pointerType || "mouse") !== "mouse" || !started || paused) return;
        clearTimeout(hideTimer.current);
        setActive(false);
      }}
      onFocus={(event: FocusEvent<HTMLDivElement>) => {
        warm();
        setKeyboardFocus(usingKeyboard.current && event.target !== event.currentTarget);
      }}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocus(false);
      }}
      onKeyDown={onKeyDown}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster || undefined}
        preload={preload}
        playsInline
        aria-label={title}
        className="absolute inset-0 h-full w-full object-contain"
        onLoadedMetadata={(event) => {
          syncDuration(event);
          if (resumeAt.current !== null) {
            event.currentTarget.currentTime = resumeAt.current;
            resumeAt.current = null;
          }
        }}
        onDurationChange={syncDuration}
        onTimeUpdate={(event) => {
          if (scrub === null) setTime(event.currentTarget.currentTime);
          syncBuffered(event.currentTarget);
        }}
        onProgress={(event) => syncBuffered(event.currentTarget)}
        onPlay={() => { setStarted(true); setPaused(false); setEnded(false); }}
        onPlaying={() => { setStarted(true); setPaused(false); setWaiting(false); setRendered(true); }}
        onPause={() => { setPaused(true); setWaiting(false); }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onSeeking={() => setSeeking(true)}
        onSeeked={(event) => { setSeeking(false); setTime(event.currentTarget.currentTime); }}
        onEnded={() => { setEnded(true); setPaused(true); setWaiting(false); }}
        onVolumeChange={(event) => {
          const video = event.currentTarget;
          setVolume(video.volume);
          setMuted(video.muted);
          try {
            window.localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: video.volume, muted: video.muted }));
          } catch {
            // Not persisting the volume is harmless.
          }
        }}
        onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
        onError={() => { setFailed(true); setWaiting(false); setSeeking(false); }}
      >
        Your browser does not support the video tag.
      </video>

      {/* The whole picture is the click target, as in any modern player. */}
      <div
        ref={surfaceRef}
        aria-hidden="true"
        data-testid="player-surface"
        className="absolute inset-0"
        onClick={onSurfaceClick}
        onDoubleClick={() => { if (pointerKind.current === "mouse") toggleFullscreen(); }}
      />

      {/* Cover from the site design: dimmed poster, gradient and quality badge until the first frame plays. */}
      <div
        aria-hidden="true"
        className={cn("pointer-events-none absolute inset-0 bg-black transition-opacity duration-300", rendered ? "opacity-0" : "opacity-100")}
      >
        {poster && (
          <img src={poster} alt="" fetchPriority="high" decoding="async" draggable={false} className="h-full w-full object-cover opacity-55" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
        {quality && (
          <span className="absolute left-2.5 top-2.5 rounded border border-white/10 bg-black/65 px-2 py-[3px] text-[10px] font-semibold tracking-[0.08em] text-zinc-100 backdrop-blur-sm">
            {quality}
          </span>
        )}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-black/30 transition-opacity duration-200",
          rendered && (paused || ended) && scrub === null ? "opacity-100" : "opacity-0",
        )}
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-1 pt-8 transition-opacity duration-200 @lg:px-3.5 @lg:pt-10",
          controlsShown ? "opacity-100" : "opacity-0",
        )}
      >
        {/* Only the controls take input; the gradient above them is click-through. */}
        <div className={cn("flex flex-wrap items-center gap-x-1 @lg:flex-nowrap @lg:gap-x-2", controlsShown && "pointer-events-auto")}>
          <ControlButton label={paused ? "Play" : "Pause"} onClick={togglePlay}>
            {paused
              ? <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              : <Pause className="h-4 w-4 fill-current" aria-hidden="true" />}
          </ControlButton>
          <div className="group/volume flex items-center">
            <ControlButton label={muted || volume === 0 ? "Unmute" : "Mute"} onClick={toggleMute}>
              <VolumeIcon className="h-4 w-4" aria-hidden="true" />
            </ControlButton>
            <div className="w-0 overflow-hidden transition-[width] duration-200 group-hover/volume:w-[72px] group-focus-within/volume:w-[72px]">
              <VolumeSlider value={muted ? 0 : volume} onChange={setLevel} />
            </div>
          </div>
          <SeekBar
            className="order-first w-full @lg:order-none @lg:w-auto @lg:flex-1"
            time={shownTime}
            duration={duration}
            buffered={buffered}
            scrubbing={scrub !== null}
            animate={!paused && !seeking && scrub === null}
            onScrub={setScrub}
            onSeek={seekTo}
          />
          <span className="whitespace-nowrap px-1 text-[11px] tabular-nums text-zinc-300">
            {formatClock(shownTime)} <span className="text-zinc-500">/</span> {formatClock(duration)}
          </span>
          <span aria-hidden="true" className="flex-1 @lg:hidden" />
          <ControlButton
            ref={settingsRef}
            label="Playback speed"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Settings className={cn("h-4 w-4 transition-transform duration-300", menuOpen && "rotate-45")} aria-hidden="true" />
          </ControlButton>
          {pipSupported && (
            <ControlButton label="Picture in picture" onClick={togglePip}>
              <PictureInPicture2 className="h-4 w-4" aria-hidden="true" />
            </ControlButton>
          )}
          <ControlButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
            {fullscreen
              ? <Minimize2 className="h-4 w-4" aria-hidden="true" />
              : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
          </ControlButton>
        </div>
      </div>

      {/* Above the control bar's gradient, so the gradient never dims or covers it. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {busy ? (
          <span role="status" className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40">
            <span aria-hidden="true" className="h-12 w-12 animate-spin rounded-full border-[3px] border-white/20 border-t-accent" />
            <span className="sr-only">Loading video…</span>
          </span>
        ) : showPlayButton ? (
          <button
            type="button"
            aria-label={ended ? "Replay video" : "Play video"}
            onClick={() => {
              play();
              // The button disappears once playing; keep keyboard shortcuts working.
              rootRef.current?.focus({ preventScroll: true });
            }}
            className="pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-[0_10px_36px_rgba(245,22,85,0.5)] transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            {ended
              ? <RotateCcw className="h-6 w-6" aria-hidden="true" />
              : <Play className="ml-1 h-6 w-6 fill-current" aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      {menuOpen && (
        <SpeedMenu
          rate={rate}
          menuRef={menuRef}
          onClose={closeMenu}
          onSelect={(speed) => {
            const video = videoRef.current;
            if (video) video.playbackRate = speed;
            closeMenu(true);
          }}
        />
      )}

      {failed && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center">
          <p role="alert" className="max-w-sm text-[13px] leading-relaxed text-zinc-200">
            The video could not be loaded. The source may be unavailable or unsupported by your browser.
          </p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retry playback
          </button>
        </div>
      )}
    </div>
  );
}

export default function VideoPlayer(props: Props) {
  const source = selectPlaybackSource(props.playableUrl, props.embedUrl);
  const relaySrc = `/api/videos/${encodeURIComponent(props.id)}/playback`;
  const player = {
    title: props.title,
    poster: props.poster,
    durationSeconds: props.durationSeconds,
    quality: props.quality,
  };
  return (
    <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-line bg-black">
      {source.kind === "direct" ? (
        <SitePlayer key={source.url} src={source.url} {...player} />
      ) : source.kind === "streamtape" ? (
        // Same-origin relay: the server resolves and consumes the IP-bound link,
        // so neither the provider's ad player nor a signed URL reaches the browser.
        <>
          <script dangerouslySetInnerHTML={{ __html: earlyPrepareScript(relaySrc) }} />
          <SitePlayer key={`${props.id}:${source.fileId}`} src={relaySrc} relayed {...player} />
        </>
      ) : source.kind === "embed" ? (
        <iframe
          src={source.url}
          title={props.title}
          className="h-full w-full"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <>
          {props.poster && <img src={props.poster} alt="" className="h-full w-full object-cover opacity-55" />}
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="rounded-lg bg-black/70 px-4 py-2 text-[13px] text-white">Video processing — check back soon</p>
          </div>
        </>
      )}
    </div>
  );
}
