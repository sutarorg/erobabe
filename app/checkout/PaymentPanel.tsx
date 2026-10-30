"use client";

import { useState } from "react";
import {
  PAYMENT_PANEL_IMAGE_FALLBACK,
  PAYMENT_PANEL_IMAGE_URL,
} from "@/lib/ads/payment";

/**
 * The fixed right-hand panel of the checkout.
 *
 * It replaces the old order-summary QR block: the panel is pinned to the
 * viewport (it never scrolls, the wizard scrolls in its own column), and it
 * contains only the advertiser payment artwork, scaled to fit so it can never
 * overflow.
 */
export default function PaymentPanel() {
  const [src, setSrc] = useState(PAYMENT_PANEL_IMAGE_URL);

  return (
    <aside
      aria-label="Payment artwork"
      className="relative border-t border-line bg-[#0e0f12] lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-hidden lg:border-l lg:border-t-0"
    >
      <div className="flex h-full w-full items-center justify-center p-5 sm:p-8 lg:p-9">
        <img
          src={src}
          alt="Pay for your erobabe advertising placement with PayPal"
          onError={() => {
            if (src !== PAYMENT_PANEL_IMAGE_FALLBACK) setSrc(PAYMENT_PANEL_IMAGE_FALLBACK);
          }}
          className="max-h-[70vh] w-auto max-w-full rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.45)] lg:max-h-[82vh]"
          loading="eager"
          decoding="async"
          // Image hosts sometimes reject a foreign referrer.
          referrerPolicy="no-referrer"
        />
      </div>
    </aside>
  );
}
