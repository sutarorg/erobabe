"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { selectPlaybackSource } from "@/lib/video/playback";

type Props = {
  id: string;
  title: string;
  poster?: string | null;
  playableUrl?: string | null;
  embedUrl?: string | null;
  provider?: string | null;
};

/** Give a visitor a beat with the poster before buffering starts on its own. */
const BUFFER_AHEAD_DELAY_MS = 1_200;

function NativePlayer({
  url,
  title,
  poster,
}: {
  url: string;
  title: string;
  poster?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ahead = useRef(false);
  const [preload, setPreload] = useState<"metadata" | "auto">("metadata");
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);

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
    if (preload !== "auto" || started) return;
    const video = videoRef.current;
    if (video && typeof video.load === "function") video.load();
  }, [preload, started]);

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
        src={url}
        aria-label={title}
        controls={started}
        preload={preload}
        poster={poster || undefined}
        playsInline
        className="h-full w-full bg-black"
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onWaiting={() => {
          if (started) setWaiting(true);
        }}
        onError={() => {
          setWaiting(false);
          setFailed(true);
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

export default function VideoPlayer(props: Props) {
  const source = selectPlaybackSource(
    props.playableUrl,
    props.embedUrl,
    props.provider,
  );
  const key = "url" in source ? `${props.id}:${source.url}` : props.id;

  return (
    <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-line bg-black">
      {source.kind === "direct" ? (
        <NativePlayer
          key={key}
          url={source.url}
          title={props.title}
          poster={props.poster}
        />
      ) : source.kind === "embed" ? (
        <iframe
          key={key}
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
          {props.poster && (
            <img
              src={props.poster}
              alt=""
              className="h-full w-full object-cover opacity-55"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="rounded-lg bg-black/70 px-4 py-2 text-[13px] text-white">
              {source.kind === "unsupported"
                ? "This legacy video provider is no longer supported."
                : "Video processing — check back soon"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
