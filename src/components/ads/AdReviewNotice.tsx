"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import {
  AD_REVIEW_FLAG_KEY,
  AD_REVIEW_HOLD_MS,
  AD_REVIEW_MAX_AGE_MS,
} from "@/lib/ads/payment";
import { cn } from "@/src/utils/cn";

function readPendingReview(): boolean {
  try {
    const raw = window.localStorage.getItem(AD_REVIEW_FLAG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { at?: number };
      const at = Number(parsed?.at || 0);
      if (at && Date.now() - at < AD_REVIEW_MAX_AGE_MS) return true;
    }
  } catch {
    /* storage unavailable — fall back to the query string */
  }
  const query = new URLSearchParams(window.location.search);
  return ["1", "true", "success"].includes((query.get("ad_review") || "").toLowerCase());
}

function clearPendingReview() {
  try {
    window.localStorage.removeItem(AD_REVIEW_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The “In review” confirmation shown when the payment page sends the
 * advertiser back.
 *
 * The checkout writes a short-lived local flag just before handing over to
 * PayPal. Landing back on the site consumes the flag, shows a deliberately
 * small card with a soft in/out animation for ten seconds, and then returns to
 * the homepage.
 */
export default function AdReviewNotice({ holdMs = AD_REVIEW_HOLD_MS }: { holdMs?: number }) {
  const router = useRouter();
  // The router object is not part of the timing contract: re-rendering the
  // surrounding layout must never cancel the ten-second hold.
  const replaceRoute = useRef(router.replace);
  replaceRoute.current = router.replace;
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!readPendingReview()) return;
    clearPendingReview();
    setVisible(true);

    const out = setTimeout(
      () => setLeaving(true),
      Math.max(0, holdMs - 700),
    );
    const done = setTimeout(() => {
      setVisible(false);
      replaceRoute.current("/");
    }, holdMs);

    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [holdMs]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center px-5"
      role="status"
      aria-live="polite"
      aria-label="Your ad is in review"
    >
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 bg-void/85 backdrop-blur-[6px]",
          leaving ? "ad-review-backdrop-out" : "ad-review-backdrop-in",
        )}
      />
      <div
        className={cn(
          "relative w-full max-w-[320px] rounded-2xl border border-line bg-card p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,0.6)]",
          leaving ? "ad-review-out" : "ad-review-in",
        )}
      >
        <span className="relative mx-auto flex h-14 w-14 items-center justify-center">
          <span aria-hidden className="ad-review-halo absolute inset-0 rounded-full bg-emerald-400/20" />
          <span className="relative flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-400/15 text-emerald-300">
            <Check aria-hidden className="h-6 w-6" strokeWidth={2.4} />
          </span>
        </span>
        <h2 className="mt-5 text-[21px] font-semibold tracking-tight text-ink">In review</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
          We’re confirming your payment and checking your banner.
        </p>
        <div className="mt-5 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="ad-review-progress h-full origin-left rounded-full bg-emerald-400"
            style={{ animationDuration: `${holdMs}ms` }}
          />
        </div>
      </div>
    </div>
  );
}
