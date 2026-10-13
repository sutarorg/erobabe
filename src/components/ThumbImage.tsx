"use client";

import { useEffect, useState } from "react";

/**
 * A thumbnail image that never renders as a broken image.
 *
 * A catalog card is only as good as its picture: a dead storage object, an
 * expired remote link, or a row whose `thumbnail_url` was saved as a bare
 * storage path all used to leave a blank box on the card. When the browser
 * cannot load the URL, the image silently swaps to the erobabe mark so the grid
 * still reads as a grid — and the console keeps the real error.
 */

const FALLBACK_THUMB = "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

export interface ThumbImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> {
  src?: string | null;
}

export default function ThumbImage({ src, alt = "", ...rest }: ThumbImageProps) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a fresh attempt — without this, a card that once failed
  // would keep showing the fallback after the admin attached a real thumbnail.
  useEffect(() => setFailed(false), [src]);

  const resolved = src && !failed ? src : FALLBACK_THUMB;

  return (
    <img
      {...rest}
      src={resolved}
      alt={alt}
      data-thumb-fallback={!src || failed ? "true" : undefined}
      onError={() => setFailed(true)}
    />
  );
}
