"use client";

import { useEffect, useRef, useState } from "react";
import { safeStreamtapeMediaUrl, selectPlaybackSource } from "@/lib/video/playback";

type Props = {
  id: string;
  title: string;
  poster?: string | null;
  playableUrl?: string | null;
  embedUrl?: string | null;
};

/** Native media playback never runs the host's advertising JavaScript. */
function NativePlayer({ url, title, poster, onRetry, autoPlay = false }: {
  url: string; title: string; poster?: string | null; onRetry?: () => void; autoPlay?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <>
    <video
      key={`${url}:${attempt}`}
      src={url}
      aria-label={title}
      controls
      autoPlay={autoPlay}
      poster={poster || undefined}
      className="h-full w-full"
      preload="metadata"
      playsInline
      onError={() => setFailed(true)}
    >Your browser does not support the video tag.</video>
    {failed && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center text-sm text-white">
      <p role="alert">The video could not be loaded. The source may be unavailable or unsupported by your browser.</p>
      <button type="button" className="rounded-lg bg-white/15 px-4 py-2" onClick={() => {
        if (onRetry) onRetry();
        else { setFailed(false); setAttempt((value) => value + 1); }
      }}>Retry playback</button>
    </div>}
  </>;
}

function StreamtapePlayer({ id, title, poster }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setFailed(false);
    setUrl(null);
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(id)}/playback`, {
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Playback unavailable");
      const data = await response.json();
      setUrl(safeStreamtapeMediaUrl(data.url));
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      request.current = null;
    }
  }

  if (url) return <NativePlayer url={url} title={title} poster={poster} onRetry={load} autoPlay />;
  return <>
    {poster && <img src={poster} alt="" className="h-full w-full object-cover opacity-55" />}
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 p-4 text-center text-sm text-white">
      {failed && <p role="alert">Ad-free playback is unavailable from this host. Please try again later.</p>}
      {loading ? <p role="status">Preparing video…</p> : <button
        type="button" onClick={load} className="rounded-lg bg-white/15 px-5 py-3 font-medium"
      >{failed ? "Retry playback" : "Play video"}</button>}
    </div>
  </>;
}

export default function VideoPlayer(props: Props) {
  const source = selectPlaybackSource(props.playableUrl, props.embedUrl);
  return <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-line bg-black">
    {source.kind === "direct" ? <NativePlayer key={source.url} url={source.url} {...props} />
      : source.kind === "streamtape" ? <StreamtapePlayer key={`${props.id}:${source.fileId}`} {...props} />
      : source.kind === "embed" ? <iframe
        src={source.url}
        title={props.title}
        className="h-full w-full"
        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      /> : <>
        {props.poster && <img src={props.poster} alt="" className="h-full w-full object-cover opacity-55" />}
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="rounded-lg bg-black/70 px-4 py-2 text-[13px] text-white">Video processing — check back soon</p>
        </div>
      </>}
  </div>;
}
