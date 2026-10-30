"use client";

import { useState } from "react";
import {
  PAYMENT_PANEL_ARTWORK_PATH,
  PAYMENT_PANEL_IMAGE_FALLBACK,
} from "@/lib/ads/payment";

/**
 * The fixed right-hand panel of the checkout.
 *
 * It replaces the old order-summary QR block: the panel is pinned to the
 * viewport (it never scrolls, the wizard scrolls in its own column), and it
 * contains only the advertiser payment artwork, scaled to fit so it can never
 * overflow.
 *
 * The artwork is requested from `/api/assets/payment-artwork`, which serves a
 * downsized, long-cached copy from our own origin instead of the multi-megabyte
 * third-party PNG the panel used to load; `priority` hints let it start before
 * the rest of the page settles, and a soft placeholder holds the frame so the
 * panel never looks broken while it arrives.
 */
export default function PaymentPanel() {
  const [stage, setStage] = useState<"cached" | "original" | "none">("cached");
  const [ready, setReady] = useState(false);

  // `cached` is the same-origin route; `original` is the hosted file it reads
  // from; `none` keeps the placeholder instead of a broken-image icon.
  const src = stage === "cached" ? PAYMENT_PANEL_ARTWORK_PATH : PAYMENT_PANEL_IMAGE_FALLBACK;

  return (
    <aside
      aria-label="Payment artwork"
      className="relative border-t border-line bg-[#0e0f12] lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-hidden lg:border-l lg:border-t-0"
    >
      <div className="flex h-full w-full items-center justify-center p-5 sm:p-8 lg:p-9">
        <div className="relative w-full max-w-[560px]">
          {/* Placeholder: same shape as the artwork, so nothing jumps into place. */}
          {!ready && (
            <div
              aria-hidden
              className="aspect-video w-full animate-pulse rounded-xl border border-white/5 bg-white/[0.04]"
            />
          )}
          <img
            src={src}
            alt="erobabe advertising placement"
            onLoad={() => setReady(true)}
            onError={() => {
              // A cached copy that cannot be built still has a working source:
              // try the hosted file, then leave the placeholder rather than a
              // broken image.
              if (stage === "cached") setStage("original");
              else setStage("none");
            }}
            className={`w-full rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.45)] transition-opacity duration-300 ${
              ready && stage !== "none" ? "opacity-100" : "absolute inset-0 opacity-0"
            }`}
            width={2560}
            height={1440}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            // The artwork host sometimes rejects a foreign referrer.
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </aside>
  );
}
