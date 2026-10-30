"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import AdCreativeCard, { isSafeAdUrl } from "./AdCreativeCard";
import AdvertiseWithUsLink from "./AdvertiseWithUsLink";
import VacantAdCard from "./VacantAdCard";
import { useMobileAds } from "./MobileAdsProvider";

/** Videos watched on this phone before an ad break. */
const VIDEOS_PER_BREAK = 3;
/** Seconds before the close button appears. */
const CLOSE_DELAY_SECONDS = 3;
const OPENED_KEY = "erobabe:mobile-video-opens";

type Phase = "idle" | "counting" | "closable";

/**
 * The mobile-only ad-break page.
 *
 * Every third video a visitor opens, the watch page is covered by a single
 * 16:9 placement. The three-second countdown is shown only as a small counter
 * beside the close button; only after it reaches zero does the close button
 * appear, and closing it lands on the video the visitor actually selected.
 * Under the slot the page prints the same faded “Advertise with us” line as
 * every other mobile placement — no countdown caption. Two videos then play
 * uninterrupted before the next break (1, 2, 3 → ad → 4, 5, 6 → ad …).
 *
 * It is client-side only and matches the `max-width: 999px` boundary the desktop
 * rails use, so the desktop watch page never sees it.
 */
export default function MobileAdBreak({
  slug,
  position = 0,
}: {
  slug: string;
  /** Banner position used to pick the creative, so the break never repeats the
   * banner that is already on screen. */
  position?: number;
}) {
  const router = useRouter();
  const { adAt } = useMobileAds();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(CLOSE_DELAY_SECONDS);

  // Count one video open per phone session — but never while the 18+ gate is
  // still covering the page, and never on desktop.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia === "function" && !window.matchMedia("(max-width: 999px)").matches) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const register = () => {
      if (cancelled) return;
      if (document.querySelector('[aria-labelledby="age-gate-title"]')) {
        attempts += 1;
        if (attempts < 40) setTimeout(register, 500);
        return;
      }
      let opens = 0;
      try {
        opens = Number(window.sessionStorage.getItem(OPENED_KEY) || 0);
      } catch {
        opens = 0;
      }
      opens += 1;
      try {
        window.sessionStorage.setItem(OPENED_KEY, String(opens));
      } catch {
        /* storage disabled — the break simply does not count */
      }
      if (opens % VIDEOS_PER_BREAK === 0) {
        setSeconds(CLOSE_DELAY_SECONDS);
        setPhase("counting");
      }
    };

    register();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Three-second countdown, then the close button.
  useEffect(() => {
    if (phase !== "counting") return;
    if (seconds <= 0) {
      setPhase("closable");
      return;
    }
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, seconds]);

  useEffect(() => {
    if (phase === "closable") closeButton.current?.focus();
  }, [phase]);

  if (phase === "idle") return null;

  const ad = adAt(position);
  const showCreative = Boolean(ad?.image_url && isSafeAdUrl(ad.destination_url));

  const close = () => {
    setPhase("idle");
    // Land on the video the visitor selected, in case the break interrupted it.
    router.push(`/video/${slug}`);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-void px-4 min-[1000px]:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Advertisement break"
    >
      <div className="absolute inset-x-0 top-0 flex justify-center pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
          Advertisement
        </span>
      </div>

      <div className="absolute right-3 top-3 h-10 w-10">
        {phase === "closable" ? (
          <button
            ref={closeButton}
            type="button"
            onClick={close}
            aria-label="Close advertisement"
            className="ad-break-close flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card text-ink-2 transition hover:border-accent/60 hover:text-ink"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        ) : (
          <span
            role="timer"
            aria-label={`Close button appears in ${seconds} second${seconds === 1 ? "" : "s"}`}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line/70 bg-card/60 text-[12px] font-semibold tabular-nums text-ink-3"
          >
            {seconds}
          </span>
        )}
      </div>

      <div className="w-full max-w-[560px]">
        {showCreative && ad ? (
          <AdCreativeCard
            creative={ad}
            slotId={1}
            campaignId={ad.campaign_id}
            className="aspect-video w-full rounded-xl"
            imageClassName="h-full w-full object-cover"
            eager
            onClick={close}
          />
        ) : (
          <VacantAdCard className="aspect-video w-full rounded-xl" />
        )}
      </div>

      {/* Same caption as every other mobile placement — the countdown lives in
          the corner counter, never as text under the slot. */}
      <AdvertiseWithUsLink className="mt-3" />
    </div>
  );
}
