"use client";

import { useState } from "react";
import {
  PAYMENT_PANEL_ARTWORK_FALLBACK,
  PAYMENT_PANEL_ARTWORK_HEIGHT,
  PAYMENT_PANEL_ARTWORK_PATH,
  PAYMENT_PANEL_ARTWORK_SIZES,
  PAYMENT_PANEL_ARTWORK_SMALL_PATH,
  PAYMENT_PANEL_ARTWORK_SMALL_WIDTH,
  PAYMENT_PANEL_ARTWORK_WIDTH,
  PAYMENT_PANEL_ASPECT,
} from "@/lib/ads/payment";

/**
 * The fixed right-hand panel of the checkout.
 *
 * It replaces the old order-summary QR block: the panel is pinned to the
 * viewport (it never scrolls, the wizard scrolls in its own column) and holds
 * one 8:9 artwork, exactly the shape of the file, so the picture is neither
 * cropped nor letterboxed at any size. The artwork is anchored to the bottom of
 * the panel on every breakpoint, so on desktop it sits on the bottom edge of
 * the screen instead of floating in the middle of the column.
 *
 * Speed: the picture is in the server HTML, is preloaded from `<head>` and is
 * served with a year-long immutable cache, and — importantly — it is *never*
 * hidden behind JavaScript. The old version rendered it at `opacity-0` until an
 * `onLoad` handler fired after hydration, so a fully downloaded image could
 * stay invisible while the bundle booted. Now the image paints as soon as the
 * browser has it, and the shimmering placeholder sits *behind* it (it is only
 * there to fill the reserved box before the bytes arrive).
 */
export default function PaymentPanel() {
  const [ready, setReady] = useState(false);

  return (
    <aside
      aria-label="Payment artwork"
      className="relative border-t border-line bg-[#0a0b0c] lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-hidden lg:border-l lg:border-t-0"
    >
      {/* Bottom-anchored: `items-end` pins the picture to the bottom of the
          panel (the bottom of the screen on desktop) with a small margin. */}
      <div className="flex h-full w-full items-end justify-center px-4 pb-5 pt-6 sm:px-8 sm:pb-8 sm:pt-10 lg:px-9 lg:pb-5 lg:pt-9">
        {/* 8:9 — the artwork's own shape. `object-cover` then has nothing to
            crop: the frame and the picture match exactly. */}
        <div
          className="relative aspect-[8/9] w-full max-w-[min(100%,560px)] overflow-hidden rounded-xl bg-[#0a0b0c] shadow-[0_24px_80px_rgba(0,0,0,0.45)] lg:h-full lg:w-auto lg:max-w-full"
          style={{ aspectRatio: PAYMENT_PANEL_ASPECT }}
        >
          {/* Behind the picture, never in front of it: the artwork is visible
              from the first paint and this only covers the empty box. */}
          {!ready && (
            <div
              aria-hidden
              className="absolute inset-0 animate-pulse rounded-xl border border-white/5 bg-white/[0.04]"
            />
          )}
          <picture>
            <source
              type="image/webp"
              srcSet={`${PAYMENT_PANEL_ARTWORK_SMALL_PATH} ${PAYMENT_PANEL_ARTWORK_SMALL_WIDTH}w, ${PAYMENT_PANEL_ARTWORK_PATH} ${PAYMENT_PANEL_ARTWORK_WIDTH}w`}
              sizes={PAYMENT_PANEL_ARTWORK_SIZES}
            />
            <img
              src={PAYMENT_PANEL_ARTWORK_FALLBACK}
              alt="erobabe advertising placements"
              onLoad={() => setReady(true)}
              className="relative h-full w-full rounded-xl object-cover"
              width={PAYMENT_PANEL_ARTWORK_WIDTH}
              height={PAYMENT_PANEL_ARTWORK_HEIGHT}
              loading="eager"
              fetchPriority="high"
            />
          </picture>
        </div>
      </div>
    </aside>
  );
}
