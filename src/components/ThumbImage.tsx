"use client";

import { useEffect, useMemo, useState } from "react";
import { posterSources } from "@/lib/video/poster";

/**
 * A thumbnail image that never renders as a broken image.
 *
 * A catalog card is only as good as its picture: a dead storage object, an
 * expired remote link, a row whose `thumbnail_url` was saved as a bare storage
 * path, or — the common one for this catalog — an adult CDN that an ad blocker
 * refuses to load all used to leave a blank box on the card.
 *
 * So the picture is asked for through this site's own poster proxy first, then
 * from the CDN directly, and only then swapped for the erobabe mark. The grid
 * always reads as a grid, and the console keeps the real error.
 */

const FALLBACK_THUMB = "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

export interface ThumbImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> {
  src?: string | null;
}

export default function ThumbImage({ src, alt = "", ...rest }: ThumbImageProps) {
  const candidates = useMemo(() => posterSources(src), [src]);
  const [attempt, setAttempt] = useState(0);

  // A new URL deserves a fresh attempt — without this, a card that once failed
  // would keep showing the fallback after the admin attached a real thumbnail.
  useEffect(() => setAttempt(0), [src]);

  const resolved = candidates[attempt] ?? FALLBACK_THUMB;
  const isFallback = resolved === FALLBACK_THUMB;

  return (
    <img
      {...rest}
      // The CDN wants no referer of ours, and the proxy does not need one.
      referrerPolicy="no-referrer"
      decoding="async"
      src={resolved}
      alt={alt}
      data-thumb-fallback={isFallback ? "true" : undefined}
      onError={() => setAttempt((value) => Math.min(value + 1, candidates.length))}
    />
  );
}
