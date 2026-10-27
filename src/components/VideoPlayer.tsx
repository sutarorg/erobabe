"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { damplipsProxyUrl, isDamplipsMediaUrl, selectPlaybackSource } from "@/lib/video/playback";
import { ALGORITHM_VERSION } from "@/lib/recommendations/ranking";

type Props = {
  id: string;
  title: string;
  poster?: string | null;
  playableUrl?: string | null;
  embedUrl?: string | null;
  provider?: string | null;
};

type PlaybackEvent = "playback_start" | "progress_25" | "progress_50" | "progress_75" | "playback_complete" | "playback_error";

function eventUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    return (char === "x" ? random : (random & 0x3 | 0x8)).toString(16);
  });
}

function usePlaybackEvents(videoId: string) {
  const sent = useRef(new Set<string>());
  const correlationId = useRef(eventUuid());
  useEffect(() => {
    sent.current.clear();
    correlationId.current = eventUuid();
  }, [videoId]);
  return useCallback((type: PlaybackEvent) => {
    if (sent.current.has(type)) return;
    sent.current.add(type);
    const idempotencyKey = eventUuid();
    void fetch("/api/recommendations/events", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ videoId, type, surface: "watch", algorithmVersion: ALGORITHM_VERSION, correlationId: correlationId.current, idempotencyKey }] }) }).catch(() => {});
  }, [videoId]);
}

/** Give a visitor a beat with the poster before buffering starts on its own. */
const BUFFER_AHEAD_DELAY_MS = 1_200;

/**
 * The native media element, with HLS support.
 *
 * A direct mp4 plays as-is. Damplips HLS playlists play natively where the
 * browser supports them (Safari) and through `hls.js` everywhere else.
 */
function NativePlayer({
  url,
  title,
  poster,
  isHls,
  onTrack,
}: {
  url: string;
  title: string;
  poster?: string | null;
  isHls: boolean;
  onTrack: (type: PlaybackEvent) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ahead = useRef(false);
  const [nativeHls, setNativeHls] = useState(false);
  const [preload, setPreload] = useState<"metadata" | "auto">("metadata");
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isHls) {
      setNativeHls(false);
      return;
    }
    try {
      const probe = document.createElement("video");
      setNativeHls(Boolean(probe.canPlayType("application/vnd.apple.mpegurl")));
    } catch {
      setNativeHls(false);
    }
  }, [isHls]);

  // HLS in browsers without native support.
  useEffect(() => {
    if (!isHls || nativeHls) return;
    const video = videoRef.current;
    if (!video) return;
    let destroyed = false;
    let instance: { destroy: () => void } | null = null;
    void (async () => {
      try {
        const { default: Hls } = await import("hls.js");
        if (destroyed || !Hls.isSupported()) return;
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        instance = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean }) => {
          if (!data?.fatal) return;
          setWaiting(false);
          setFailed(true);
          onTrack("playback_error");
        });
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, [url, isHls, nativeHls, attempt, onTrack]);

  const bufferAhead = useCallback(() => {
    if (!ahead.current) {
      ahead.current = true;
      setPreload("auto");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(bufferAhead, BUFFER_AHEAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [bufferAhead, attempt]);

  // Setting `preload` does not restart the media element's resource selection
  // on its own; `load()` is what actually applies the buffering hint.
  useEffect(() => {
    if (preload !== "auto" || started || (isHls && !nativeHls)) return;
    const video = videoRef.current;
    if (video && typeof video.load === "function") video.load();
  }, [preload, started, isHls, nativeHls]);

  const start = () => {
    bufferAhead();
    setFailed(false);
    setStarted(true);
    setWaiting(true);
    const video = videoRef.current;
    if (!video) return;
    try {
      // Called inside the click gesture, so unmuted playback is allowed. A
      // rejection is not an error the visitor must be told about: the media
      // element reports real failures through `onError`.
      const play = video.play() as Promise<void> | undefined;
      play?.catch(() => undefined);
    } catch {
      /* Older engines throw synchronously; controls stay available. */
    }
  };

  const retry = () => {
    ahead.current = false;
    setFailed(false);
    setStarted(false);
    setWaiting(false);
    setAttempt((value) => value + 1);
  };

  return (
    <div
      className="relative h-full w-full"
      onPointerEnter={bufferAhead}
      onPointerDown={bufferAhead}
      onFocus={bufferAhead}
      onTouchStart={bufferAhead}
    >
      <video
        key={`${url}:${attempt}`}
        ref={videoRef}
        src={isHls && !nativeHls ? undefined : url}
        aria-label={title}
        controls={started}
        preload={preload}
        poster={poster || undefined}
        playsInline
        className="h-full w-full bg-black"
        onPlay={() => onTrack("playback_start")}
        onTimeUpdate={(event) => {
          const media = event.currentTarget;
          if (!media.duration || !Number.isFinite(media.duration)) return;
          const progress = media.currentTime / media.duration;
          if (progress >= 0.25) onTrack("progress_25");
          if (progress >= 0.5) onTrack("progress_50");
          if (progress >= 0.75) onTrack("progress_75");
        }}
        onEnded={() => onTrack("playback_complete")}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onWaiting={() => {
          if (started) setWaiting(true);
        }}
        onError={() => {
          setWaiting(false);
          setFailed(true);
          onTrack("playback_error");
        }}
      >
        Your browser does not support the video tag.
      </video>

      {!started && !failed && (
        <button
          type="button"
          onClick={start}
          aria-label="Play video"
          className="group absolute inset-0 flex items-center justify-center bg-black/35 transition-colors hover:bg-black/20"
        >
          {poster ? (
            <img
              src={poster}
              alt=""
              aria-hidden
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover opacity-80"
            />
          ) : null}
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-[0_10px_30px_rgba(245,22,85,0.45)] transition-transform group-hover:scale-[1.06]">
            <Play
              className="h-7 w-7 translate-x-[1px] fill-current"
              aria-hidden
            />
          </span>
        </button>
      )}

      {started && waiting && !failed && (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 bottom-14 flex items-center justify-center gap-2 text-[12px] font-medium text-white/90"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Preparing video…
        </p>
      )}

      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center text-sm text-white">
          <p role="alert">
            The video could not be loaded. The source may be unavailable or
            unsupported by your browser.
          </p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 font-medium hover:bg-white/25"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Retry playback
          </button>
        </div>
      )}
    </div>
  );
}

const HLS_PATTERN = /\.m3u8(?:[?#]|$)/i;

export default function VideoPlayer(props: Props) {
  const onTrack = usePlaybackEvents(props.id);
  const source = selectPlaybackSource(props.playableUrl, props.embedUrl, props.provider);
  const key = "url" in source ? `${props.id}:${source.url}` : props.id;

  return (
    <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-line bg-black">
      {source.kind === "direct" ? (
        <NativePlayer
          key={key}
          url={isDamplipsMediaUrl(source.url) ? damplipsProxyUrl(source.url) : source.url}
          isHls={HLS_PATTERN.test(source.url)}
          title={props.title}
          poster={props.poster}
          onTrack={onTrack}
        />
      ) : source.kind === "embed" ? (
        <iframe
          key={key}
          src={source.url}
          title={props.title}
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <>
          {props.poster && <img src={props.poster} alt="" className="h-full w-full object-cover opacity-55" />}
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="rounded-lg bg-black/70 px-4 py-2 text-[13px] text-white">
              {source.kind === "unsupported"
                ? "This video source is no longer supported."
                : "This video is not available yet — check back soon."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
