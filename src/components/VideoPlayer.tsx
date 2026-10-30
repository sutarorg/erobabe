"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import {
  damplipsProxyUrl,
  isDamplipsMediaUrl,
  isDamplipsPostPage,
  isStreamProxyUrl,
  playbackCandidates,
  selectPlaybackSource,
} from "@/lib/video/playback";
import { isHlsUrl } from "@/lib/video/hls";
import { ALGORITHM_VERSION } from "@/lib/recommendations/ranking";

/**
 * Every destination worth trying for one catalog row, best first.
 *
 * The rule lives in `lib/video/playback` so the server and the player agree: a
 * direct host file plays immediately, and only a playlist or a post page is
 * handed to the proxy first. Re-exported here because the player is where the
 * order matters, and its tests read it from this module.
 */
export { playbackCandidates };

/**
 * Is this catalog destination something that has to be built before it can
 * play — a playlist, or a post page the proxy must resolve?
 *
 * A direct file answers `false`, which is the whole point: `…/video7/717/79.mp4`
 * is streamed by the element itself, so nothing may be shown over it that
 * suggests it is being "prepared".
 */
export function needsPreparation(url: string): boolean {
  return isDamplipsPostPage(url) || isHlsUrl(url);
}

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
 * True when the element can play an HLS playlist itself.
 *
 * Safari and every iOS browser can, and there the element streams a playlist
 * without Media Source Extensions. Detecting that before importing `hls.js`
 * means such a browser starts buffering from the server-rendered `src`
 * immediately, instead of waiting for a JavaScript chunk (and then discovering
 * `Hls.isSupported()` is false on iOS anyway).
 */
export function playsHlsNatively(element: HTMLVideoElement | null): boolean {
  if (!element || typeof element.canPlayType !== "function") return false;
  return Boolean(element.canPlayType("application/vnd.apple.mpegurl"));
}

/**
 * `referrerPolicy` is missing from React's media attribute types, but the
 * browser honours it on a `<video>` element, so it is spread in as a plain
 * attribute rather than typed.
 *
 * A damplips file is played straight from its host, so the request is
 * cross-origin and hotlink protection gets a vote. Those rules usually reject a
 * **foreign** referer but allow a request with none, so the direct attempt
 * sends no referrer at all. Our own proxy is same-origin and needs nothing.
 */
function referrerPolicyForCandidate(url: string, index: number): Record<string, string> {
  if (isStreamProxyUrl(url)) return {};
  if (index > 0 || isDamplipsMediaUrl(url)) return { referrerPolicy: "no-referrer" };
  return {};
}

/**
 * How long a destination may deliver **nothing at all** before the player moves
 * on to the next one.
 *
 * A media element that is waiting on a request which never answers fires no
 * error: it just sits in `waiting` for ever. That is the state this deadline
 * removes — if no byte, no metadata and no duration has arrived within this
 * window, the next destination is tried (and, once every destination is spent,
 * the visitor gets a real error with a retry button).
 *
 * Deliberately generous: a 100+ MB file on a slow line is *downloading*, not
 * stuck, and cutting it over to the proxy would make it slower, not faster.
 */
export const STALL_TIMEOUT_MS = 12_000;

/** How long the reachability probe may take before it is treated as "blocked". */
export const PROBE_TIMEOUT_MS = 2_500;

/**
 * Can this browser reach the media host *at all*?
 *
 * A `<video>` element reports a blocked request the same way it reports a dead
 * file — sometimes not at all, just an endless wait — so a visitor whose ISP,
 * DNS filter or ad-blocker drops `video.damplips.com` would sit on a black
 * player (or, before this, on "Preparing video…") for the whole stall window
 * before the proxy got a turn.
 *
 * A `HEAD` request answers that question in milliseconds. `mode: "no-cors"` is
 * deliberate: we are asking "did this request leave the building", not reading
 * a response, so no CORS grant is needed and an opaque reply still counts as
 * success. Any rejection — DNS, connection reset, extension block, timeout —
 * means the direct file is not an option for this visitor, and the proxy behind
 * it is tried instead.
 */
/**
 * What the media host actually answered the *browser*, not just "reachable".
 *
 * A `no-cors` request cannot read a status, so a block page and a real file look
 * identical — which is exactly how a visitor ends up with "media host reachable:
 * yes" and a dead player. damplips' media host sends `Access-Control-Allow-Origin:
 * *`, so a CORS `HEAD` can be read: a `video/*` answer means the bytes are
 * available to this browser, an `text/html` one means the host (or the visitor's
 * ISP) answered with a document instead of the file.
 */
export type DirectProbe = { status: number | null; contentType: string | null };

/**
 * One signal that aborts when either input does.
 *
 * A probe is cancelled by *two* things: its own timeout, and the visitor moving
 * on to another video. `AbortSignal.any` does this natively where available;
 * older engines get the same behaviour by forwarding the abort by hand.
 */
function combineSignals(timeout: AbortSignal, cancelled: AbortSignal): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, cancelled]);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (timeout.aborted || cancelled.aborted) abort();
  timeout.addEventListener("abort", abort, { once: true });
  cancelled.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export async function probeDirectSource(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<DirectProbe | null> {
  if (typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = signal ? combineSignals(controller.signal, signal) : controller.signal;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: combined,
    });
    return { status: response.status, contentType: response.headers.get("content-type") };
  } catch {
    // No CORS grant, a connection reset or a timeout: the browser cannot read
    // this resource, which is itself the answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function mediaHostReachable(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<boolean> {
  if (typeof fetch !== "function") return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = signal ? combineSignals(controller.signal, signal) : controller.signal;
  try {
    await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: combined,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when a destination is a document that has to be turned into video before
 * a single frame can exist.
 *
 * A playlist is a manifest whose segments still have to be fetched, and a
 * damplips post page is HTML that the proxy has to resolve into a file. Those
 * take a moment, and saying so is honest. A **file** — the direct host URL, e.g.
 * `https://video.damplips.com/video7/717/79.mp4` — is none of that: the element
 * streams it exactly as damplips' own player does, so showing a "Preparing
 * video…" screen over it is simply wrong (and is what this component used to
 * do).

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
  prepares: _prepares,
  title,
  poster,
  onTrack,
}: {
  urls: string[];
  /** Derived from the catalog URL, not from the proxy URL it is played through. */
  isHls: boolean;
  /** Does this catalog destination still have to be turned into media? */
  prepares: boolean;
  title: string;
  poster?: string | null;
  onTrack: (type: PlaybackEvent) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recoveries = useRef(0);
  const startedRef = useRef(false);
  /** Has this attempt produced anything at all — a byte, metadata, a frame? */
  const dataSeen = useRef(false);
  const [source, setSource] = useState(0);
  const [strategy, setStrategy] = useState<Strategy>(isHls ? "hls" : "native");
  const [triedAlternative, setTriedAlternative] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  /**
   * A damplips file asked for as a `no-cors` media request can be refused while
   * the same file requested in CORS mode is allowed — the host publishes
   * `Access-Control-Allow-Origin: *`. `crossOrigin` turns the element's request
   * into that second kind, so it is a real second attempt, not a cosmetic one.
   */
  const [corsMode, setCorsMode] = useState(false);
  /** What actually went wrong, for the "Technical details" block. */
  const [diagnosis, setDiagnosis] = useState<{
    error: string | null;
    hostReachable: boolean | null;
    direct: DirectProbe | null | undefined;
  }>({ error: null, hostReachable: null, direct: undefined });

  // Media events fire outside React's render cycle, so the handlers below read
  // "has the visitor pressed play" from a ref.
  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  /**
   * Leaving this video stops its download immediately.
   *
   * A `<video>` keeps fetching while it is mounted, so a visitor who opens a
   * second video from the shelf while the first is still loading would have two
   * transfers competing for the same bandwidth — the new one slower precisely
   * because of the one they abandoned. Dropping `src` and reloading the element
   * tells the browser to cancel the request instead of finishing it in the
   * background; the element is unmounted a moment later anyway (the player is
   * keyed by video id), so this is the hook that makes the switch instant
   * rather than merely eventual.
   */
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video) return;
      try {
        video.pause();
        video.removeAttribute("src");
        // `load()` with no source aborts the in-flight transfer and releases the
        // decoder, which is what actually frees the connection.
        video.load();
      } catch {
        /* The element may already be detached by the browser. */
      }
    };
  }, []);

  const url = urls[Math.min(source, urls.length - 1)];
  /** The direct host file, if this row has one — never a proxied URL. */
  const directUrl =
    urls.find((candidate) => !isStreamProxyUrl(candidate)) ??
    (() => {
      const proxy = urls.find((candidate) => isStreamProxyUrl(candidate));
      if (!proxy) return null;
      try {
        return new URL(proxy, "https://erobabe.local").searchParams.get("src");
      } catch {
        return null;
      }
    })();

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
    setStarted(true);
    setFailed(false);
    dataSeen.current = false;

    // An mp4 that the element cannot decode is not a playlist. Spending an
    // HLS attempt on it delays the next real destination and is what left
    // some damplips files on "source not supported".
    const mayBePlaylist = isHls || (!isStreamProxyUrl(url) && !isDamplipsMediaUrl(url));
    if (allowAlternative && !triedAlternative && mayBePlaylist) {
      setTriedAlternative(true);
      setStrategy((current) => (current === "hls" ? "native" : "hls"));
      setAttempt((value) => value + 1);
      return;
    }

    // The same file, requested in CORS mode. Cheap, and it is the difference
    // between "the host refuses media requests from other sites" and "the host
    // refuses this visitor".
    if (!corsMode && !isStreamProxyUrl(url) && isDamplipsMediaUrl(url)) {
      setCorsMode(true);
      setAttempt((value) => value + 1);
      return;
    }

    if (source < urls.length - 1) {
      setTriedAlternative(false);
      setCorsMode(false);
      setStrategy(isHls ? "hls" : "native");
      setSource((value) => value + 1);
      setAttempt((value) => value + 1);
      return;
    }

    setFailed(true);
    onTrack("playback_error");
  }, [corsMode, isHls, onTrack, source, triedAlternative, urls, url]);

  /**
   * Ask the media host whether it is reachable at all, and if it is not, move
   * to the proxy immediately instead of waiting for a media error that a
   * blocked request may never fire.
   *
   * This runs once per destination list, in parallel with the element's own
   * `preload`: when the host *is* reachable nothing changes and playback starts
   * from the direct file exactly as before.
   */
  // Deliberately keyed on the string, not on `urls`: the caller rebuilds that
  // array on every render, and probing on identity would hit the host again and
  // again. One probe per direct destination.
  const probeTarget = urls.length > 1 && !isStreamProxyUrl(urls[0]) ? urls[0] : null;
  const probed = useRef<string | null>(null);
  useEffect(() => {
    if (!probeTarget || probed.current === probeTarget) return;
    probed.current = probeTarget;
    let cancelled = false;
    // Switching to another video must not leave a HEAD request running against
    // the media host: the answer is now useless, and the new video's player
    // starts its own probe.
    const controller = new AbortController();
    void mediaHostReachable(probeTarget, PROBE_TIMEOUT_MS, controller.signal).then((reachable) => {
      if (cancelled) return;
      setDiagnosis((current) => ({ ...current, hostReachable: reachable }));
      if (reachable) return;
      // The element has not been asked to fetch anything yet, so this costs
      // nothing: it only changes which destination `url` points at.
      setTriedAlternative(false);
      setSource((value) => (value === 0 ? 1 : value));
      setAttempt((value) => value + 1);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [probeTarget]);

  /**
   * The fallback has a deadline.
   *
   * Nothing guarantees a media element will ever tell us that a request went
   * nowhere: a host that accepts the connection and never answers produces no
   * `error` event, only `waiting`. Once playback has been asked for, an attempt
   * that has produced nothing at all within `STALL_TIMEOUT_MS` is abandoned for
   * the next destination — and when there is no next destination the visitor is
   * shown a real error with a retry button.
   *
   * This is **not** a loading screen: a file that is downloading stays exactly
   * where it is (see the `readyState` guard), and no "Preparing video…" text is
   * rendered over a plain file in the first place.
   */
  useEffect(() => {
    dataSeen.current = false;
    if (!started || failed) return;
    const timer = setTimeout(() => {
      if (dataSeen.current) return;
      // `readyState >= HAVE_METADATA` means the element has the file's
      // information and is genuinely buffering it: leave it alone.
      if ((videoRef.current?.readyState ?? 0) >= 1) return;
      // The last destination is still in flight — flashing the error panel
      // over it is what the visitor saw while the edge stream was warming up.
      if (source >= urls.length - 1) return;
      handleFailure(false);
    }, STALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [url, strategy, attempt, started, failed, handleFailure, source, urls.length]);

  // HLS in browsers without native support.
  useEffect(() => {
    if (strategy !== "hls") return;
    const video = videoRef.current;
    if (!video) return;

    // First attempt, and the browser plays playlists by itself: hand the
    // playlist to the element now so buffering starts without hls.js.
    if (attempt === 0 && !triedAlternative && playsHlsNatively(video)) {
      setStrategy("native");
      return;
    }

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
          // Start pulling the first fragment while the manifest is still being
          // parsed: the difference between "Preparing video…" and a frame.
          startFragPrefetch: true,
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
  }, [url, strategy, attempt, triedAlternative, handleFailure]);

  /** Resume as soon as the element exists — no click gate. */
  useEffect(() => {
    startedRef.current = true;
    setStarted(true);
    const video = videoRef.current;
    if (!video || failed) return;
    const kick = () => {
      try {
        const play = video.play() as Promise<void> | undefined;
        play?.catch(() => {
          video.muted = true;
          void (video.play() as Promise<void> | undefined)?.catch(() => undefined);
        });
      } catch {
        /* Older engines throw synchronously. */
      }
    };
    kick();
  }, [url, strategy, attempt, corsMode, failed]);

  /** The first moment playback can really begin, whatever the strategy. */
  const resume = useCallback(() => {
    setWaiting(false);
    const video = videoRef.current;
    if (!video || !startedRef.current) return;
    if (!video.paused) return;
    const play = video.play() as Promise<void> | undefined;
    play?.catch(() => {
      video.muted = true;
      void (video.play() as Promise<void> | undefined)?.catch(() => undefined);
    });
  }, []);

  const retry = () => {
    recoveries.current = 0;
    setCorsMode(false);
    setFailed(false);
    setStarted(true);
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
        key={`${url}:${strategy}:${attempt}:${corsMode ? "cors" : "media"}`}
        ref={videoRef}
        src={strategy === "native" ? url : undefined}
        // A blob has no origin to check; a host file may only be readable in
        // CORS mode, which is exactly what this second attempt asks for.
        crossOrigin={corsMode ? "anonymous" : undefined}
        // A direct file is fetched from its host, where hotlink protection
        // usually rejects a foreign referer but allows a request without one.
        {...referrerPolicyForCandidate(url, source)}
        aria-label={title}
        autoPlay
        controls
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        preload="auto"
        poster={poster || undefined}
        playsInline
        className="h-full w-full bg-black"
        onContextMenu={(event) => event.preventDefault()}
        onLoadedMetadata={() => {
          dataSeen.current = true;
          resume();
        }}
        onProgress={() => {
          dataSeen.current = true;
        }}
        onPlay={() => onTrack("playback_start")}
        onTimeUpdate={(event) => {
          dataSeen.current = true;
          const media = event.currentTarget;
          if (!media.duration || !Number.isFinite(media.duration)) return;
          const progress = media.currentTime / media.duration;
          if (progress >= 0.25) onTrack("progress_25");
          if (progress >= 0.5) onTrack("progress_50");
          if (progress >= 0.75) onTrack("progress_75");
        }}
        onEnded={() => onTrack("playback_complete")}
        onPlaying={() => {
          dataSeen.current = true;
          setWaiting(false);
          setFailed(false);
        }}
        onLoadedData={() => {
          dataSeen.current = true;
          resume();
        }}
        onCanPlay={() => {
          dataSeen.current = true;
          resume();
        }}
        onWaiting={() => {
          if (startedRef.current) setWaiting(true);
        }}
        onError={(event) => {
          const code = event.currentTarget.error?.code;
          setDiagnosis((current) => ({
            ...current,
            error: `media error ${code ?? "unknown"}${
              {
                1: " (aborted)",
                2: " (network)",
                3: " (decode)",
                4: " (source not supported or unreachable)",
              }[code ?? 0] ?? ""
            }`,
          }));
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

      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center text-sm text-white">
          <p role="alert">
            {diagnosis.direct && !diagnosis.direct.contentType?.startsWith("video/") ? (
              <>
                This video could not be loaded: the host answered with{" "}
                <span className="font-mono">{diagnosis.direct.contentType || "no content type"}</span>{" "}
                instead of a video.
              </>
            ) : (
              <>The video could not be loaded. The source may be unavailable or unsupported by your browser.</>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 font-medium hover:bg-white/25"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Retry playback
            </button>
            {/*
              Some media hosts only serve a file to a browser that has proven
              itself, which a `<video>` element mid-page cannot do but a normal
              navigation can. Opening the destination is the one action that
              turns "blocked" into "plays", so it is offered next to Retry.
            */}
            {directUrl ? (
              <a
                href={directUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-lg border border-white/25 px-4 py-2 font-medium text-white/90 hover:bg-white/10"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                Open the video directly
              </a>
            ) : null}
          </div>
          {directUrl ? (
            <p className="max-w-[420px] text-[11px] leading-relaxed text-white/60">
              If the link shows a browser check, complete it there and then press{" "}
              <span className="text-white/80">Retry playback</span> — the check also
              unblocks this player.
            </p>
          ) : null}
          {/*
            A player that says only "could not be loaded" cannot be fixed from a
            screenshot. These details name the destination that was tried and
            what the element reported, which is what turns a bug report into a
            diagnosis — including on a visitor's own network.
          */}
          <details className="w-full max-w-[420px] text-left text-[11px] leading-relaxed text-white/70">
            <summary className="cursor-pointer text-center">Technical details</summary>
            <ul className="mt-2 space-y-0.5 break-all font-mono">
              <li>last source: {url}</li>
              <li>media host reachable: {diagnosis.hostReachable === null ? "not checked" : diagnosis.hostReachable ? "yes" : "no"}</li>
              <li>
                direct answer:{" "}
                {diagnosis.direct === undefined
                  ? "not checked"
                  : diagnosis.direct === null
                    ? "unreadable (blocked, or no CORS grant)"
                    : `${diagnosis.direct.status ?? "?"} ${diagnosis.direct.contentType ?? ""}`.trim()}
              </li>
              <li>last error: {diagnosis.error || "none reported by the browser"}</li>
              <li>destinations tried: {urls.length}</li>
            </ul>
          </details>
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
          prepares={needsPreparation(source.url)}
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
