"use client";

import { useState } from "react";
import { selectPlaybackSource } from "@/lib/video/playback";

type Props = {
  id: string;
  title: string;
  poster?: string | null;
  playableUrl?: string | null;
  embedUrl?: string | null;
};

/** Native media playback never runs the host's advertising JavaScript. */
function NativePlayer({ url, title, poster, autoPlay = false }: {
  url: string; title: string; poster?: string | null; autoPlay?: boolean;
}) {
  const [loading, setLoading] = useState(autoPlay);
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
      onLoadStart={() => setLoading(true)}
      onCanPlay={() => setLoading(false)}
      onPlaying={() => setLoading(false)}
      onError={() => { setLoading(false); setFailed(true); }}
    >Your browser does not support the video tag.</video>
    {loading && !failed && <p role="status" className="pointer-events-none absolute inset-x-0 top-3 text-center text-sm text-white">Preparing video…</p>}
    {failed && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center text-sm text-white">
      <p role="alert">The video could not be loaded. The source may be unavailable or unsupported by your browser.</p>
      <button type="button" className="rounded-lg bg-white/15 px-4 py-2" onClick={() => {
        setFailed(false); setLoading(true); setAttempt((value) => value + 1);
      }}>Retry playback</button>
    </div>}
  </>;
}

function StreamtapePlayer({ id, title, poster }: Props) {
  const [started, setStarted] = useState(false);
  // Keep ticket creation and media consumption on the same server/IP. Using
  // the native request also preserves Range, cancellation, and mobile playback.
  if (started) return <NativePlayer
    url={`/api/videos/${encodeURIComponent(id)}/playback`}
    title={title} poster={poster} autoPlay
  />;
  return <>
    {poster && <img src={poster} alt="" className="h-full w-full object-cover opacity-55" />}
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 p-4 text-center text-sm text-white">
      <button type="button" onClick={() => setStarted(true)} className="rounded-lg bg-white/15 px-5 py-3 font-medium">
        Play video
      </button>
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
