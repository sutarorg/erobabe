"use client";

import { useState } from "react";
import {
  PAYMENT_PANEL_ARTWORK_FALLBACK,
  PAYMENT_PANEL_ARTWORK_HEIGHT,
  PAYMENT_PANEL_ARTWORK_PATH,
  PAYMENT_PANEL_ARTWORK_WIDTH,
  PAYMENT_PANEL_ASPECT,
} from "@/lib/ads/payment";

/**
 * The fixed right-hand panel of the checkout.
 *
 * It replaces the old order-summary QR block: the panel is pinned to the
 * viewport (it never scrolls, the wizard scrolls in its own column) and holds
 * one 8:9 artwork, exactly the shape of the file, so the picture is neither
 * cropped nor letterboxed at any size.
 *
 * Both files are static and same-origin, and the WebP is roughly a quarter of
 * the PNG, so the picture arrives with the document instead of after a cold
 * fetch to an image host.
 */
export default function PaymentPanel() {
  const [ready, setReady] = useState(false);

  return (
    <aside
      aria-label="Payment artwork"
      className="relative border-t border-line bg-[#0a0b0c] lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-hidden lg:border-l lg:border-t-0"
    >
      <div className="flex h-full w-full items-center justify-center p-4 sm:p-8 lg:p-9">
        {/* 8:9 — the artwork's own shape. `object-cover` then has nothing to
            crop: the frame and the picture match exactly. */}
        <div
          className="relative aspect-[8/9] w-full max-w-[min(100%,560px)] overflow-hidden rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.45)] lg:h-full lg:w-auto lg:max-w-full"
          style={{ aspectRatio: PAYMENT_PANEL_ASPECT }}
        >
          {!ready && (
            <div
              aria-hidden
              className="absolute inset-0 animate-pulse rounded-xl border border-white/5 bg-white/[0.04]"
            />
          )}
          <picture>
            <source srcSet={PAYMENT_PANEL_ARTWORK_PATH} type="image/webp" />
            <img
              src={PAYMENT_PANEL_ARTWORK_FALLBACK}
              alt="erobabe advertising placements"
              onLoad={() => setReady(true)}
              className={`h-full w-full rounded-xl object-cover transition-opacity duration-300 ${
                ready ? "opacity-100" : "opacity-0"
              }`}
              width={PAYMENT_PANEL_ARTWORK_WIDTH}
              height={PAYMENT_PANEL_ARTWORK_HEIGHT}
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </picture>
        </div>
      </div>
    </aside>
  );
}
