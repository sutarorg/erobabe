"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import {
  damplipsProxyUrl,
  isDamplipsMediaUrl,
  isDamplipsPostPage,
  selectPlaybackSource,
} from "@/lib/video/playback";
import { isHlsUrl } from "@/lib/video/hls";
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

/** How the media element is fed: a plain file, or a playlist through hls.js. */
type Strategy = "native" | "hls";

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

/**
 * Every destination worth trying for one catalog row, best first.
 *
 * damplips media is asked for through the same-origin proxy, which supplies the
 * referer the host requires, resolves a post page into the file it advertises,
 * and rewrites HLS playlists. The unproxied address is kept as a second
 * attempt: if the proxy itself is the problem (an outage or a blocking
 * intermediary), the browser can still play the file directly — except for a
 * post page, which is HTML and only the proxy can turn into media.
 */
export function playbackCandidates(url: string): string[] {
  if (!isDamplipsMediaUrl(url)) return [url];
  const proxied = damplipsProxyUrl(url);
  return isDamplipsPostPage(url) ? [proxied] : [proxied, url];
}

/**
 * `referrerPolicy` is missing from React's media attribute types, but the
 * browser honours it on a `<video>` element, so it is spread in as a plain
 * attribute rather than typed.
 */
function fallbackReferrerPolicy(source: number): Record<string, string> {
  return source > 0 ? { referrerPolicy: "no-referrer" } : {};
}

/**
 * The native media element, with HLS support.
 *
 * A direct mp4 plays as-is. A playlist plays through `hls.js` everywhere except
 * Safari, which plays it natively. Playlists are not always named `.m3u8` and
 * files are not always what they claim, so a source that fails in one strategy
 * is retried in the other before the next destination is tried — that is what
 * turns "the video could not be loaded" back into a playing video.
 */
function NativePlayer({
  urls,
  isHls,
  title,
  poster,
  onTrack,
}: {
  urls: string[];
  /** Derived from the catalog URL, not from the proxy URL it is played through. */
  isHls: boolean;
  title: string;
  poster?: string | null;
  onTrack: (type: PlaybackEvent) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recoveries = useRef(0);
  const startedRef = useRef(false);
  const [source, setSource] = useState(0);
  const [strategy, setStrategy] = useState<Strategy>(isHls ? "hls" : "native");
  const [triedAlternative, setTriedAlternative] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);

  // Media events fire outside React's render cycle, so the handlers below read
  // "has the visitor pressed play" from a ref.
  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  const url = urls[Math.min(source, urls.length - 1)];

  /**
   * A source that fails is retried in the other strategy, then replaced by the
   * next destination silently; only when everything has failed does the
   * visitor see an error.
   *
   * `allowAlternative` is only set when the element itself says the *content*
   * is undecodable (MEDIA_ERR_DECODE / MEDIA_ERR_SRC_NOT_SUPPORTED) or when
   * hls.js gave up: those are the cases where the other strategy can succeed.
   * A network failure is never retried in the other strategy, so a dead
   * destination still fails over quickly.
   */
  const handleFailure = useCallback((allowAlternative = false) => {
    setWaiting(false);
    setStarted(false);
    setFailed(false);

    if (allowAlternative && !triedAlternative) {
      setTriedAlternative(true);
      setStrategy((current) => (current === "hls" ? "native" : "hls"));
      setAttempt((value) => value + 1);
      return;
    }

    if (source < urls.length - 1) {
      setTriedAlternative(false);
      setStrategy(isHls ? "hls" : "native");
      setSource((value) => value + 1);
      setAttempt((value) => value + 1);
      return;
    }

    setFailed(true);
    onTrack("playback_error");
  }, [isHls, onTrack, source, triedAlternative, urls.length]);

  // HLS in browsers without native support.
  useEffect(() => {
    if (strategy !== "hls") return;
    const video = videoRef.current;
    if (!video) return;
    let destroyed = false;
    let instance: { destroy: () => void } | null = null;
    recoveries.current = 0;

    void (async () => {
      try {
        const { default: Hls } = await import("hls.js");
        if (destroyed) return;
        if (!Hls.isSupported()) {
          // No Media Source Extensions here. The plain element may still manage
          // the source (some browsers read the container themselves), otherwise
          // playback moves on instead of sitting on "Preparing video…".
          handleFailure(true);
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // A transient failure from our own proxy should be retried inside
          // hls.js rather than ending playback.
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 6,
          manifestLoadingRetryDelay: 500,
          levelLoadingRetryDelay: 500,
          fragLoadingRetryDelay: 500,
        });
        instance = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          if (!destroyed) hls.loadSource(url);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (destroyed) return;
          setWaiting(false);
          // The visitor may have clicked Play before the manifest arrived; the
          // earlier `play()` had nothing to start, so start it now.
          const element = videoRef.current;
          if (element && startedRef.current && element.paused) {
            const play = element.play() as Promise<void> | undefined;
            play?.catch(() => undefined);
          }
        });
        hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean; type?: string }) => {
          if (destroyed || !data?.fatal) return;
          const recoverable = data.type === Hls.ErrorTypes.NETWORK_ERROR || data.type === Hls.ErrorTypes.MEDIA_ERROR;
          if (recoverable && recoveries.current < 2) {
            recoveries.current += 1;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else hls.startLoad();
            return;
          }
          handleFailure(true);
        });
      } catch {
        handleFailure(true);
      }
    })();

    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, [url, strategy, attempt, handleFailure]);


  /** The first moment playback can really begin, whatever the strategy. */
  const resume = useCallback(() => {
    setWaiting(false);
    const video = videoRef.current;
    if (!video || !startedRef.current) return;
    if (!video.paused) return;
    const play = video.play() as Promise<void> | undefined;
    play?.catch(() => undefined);
  }, []);

  const start = () => {
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
    recoveries.current = 0;
    setFailed(false);
    setStarted(false);
    setWaiting(false);
    setTriedAlternative(false);
    setStrategy(isHls ? "hls" : "native");
    setSource(0);
    setAttempt((value) => value + 1);
  };

  return (
    <div
      className="relative h-full w-full"
    >
      <video
        key={`${url}:${strategy}:${attempt}`}
        ref={videoRef}
        src={strategy === "native" ? url : undefined}
        // The fallback destination is damplips itself. Hotlink protection there
        // usually rejects a foreign referer but allows a request without one.
        {...fallbackReferrerPolicy(source)}
        aria-label={title}
        controls={started}
        preload="auto"
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
        onLoadedData={resume}
        onCanPlay={resume}
        onWaiting={() => {
          if (startedRef.current) setWaiting(true);
        }}
        onError={(event) => {
          const code = event.currentTarget.error?.code;
          // 1 = MEDIA_ERR_ABORTED: a load we cancelled ourselves, not a failure.
          if (code === 1) return;
          // 3 = decode error, 4 = the element cannot use this source at all:
          // both mean the bytes are unreachable through this strategy, so the
          // other one is worth a try before giving up on the destination.
          handleFailure(code === 3 || code === 4);
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
  const onTrack = usePlaybackEvents(props.id);
  const source = selectPlaybackSource(props.playableUrl, props.embedUrl, props.provider);
  const key = "url" in source ? `${props.id}:${source.url}` : props.id;

  return (
    <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-line bg-black">
      {source.kind === "direct" ? (
        <NativePlayer
          key={key}
          urls={playbackCandidates(source.url)}
          isHls={isHlsUrl(source.url)}
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
          loading="eager"
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
