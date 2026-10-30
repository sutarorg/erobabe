"use client";

import { useEffect, useRef, useState } from "react";
import { creativeImageStyle, type CreativeFocus } from "@/lib/ads/focus";

export type AdCreativeView = {
  id?: string;
  image_url?: string;
  destination_url?: string;
  title?: string;
  /**
   * The framing the advertiser chose at checkout. Absent for legacy campaigns,
   * which were uploaded as 16:9 and need no adjustment.
   */
  focus?: CreativeFocus | null;
};

export function isSafeAdUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * A paid creative rendered inside one of the ten 16:9 placements.
 *
 * Impression counting is shared by the desktop rails and the mobile banners:
 * a loaded image, at least 50% visible, continuously for one second in a
 * foreground tab. Only creatives that carry both an analytics campaign id and
 * a creative id are measurable, and clicks are counted through the same
 * verified identifiers.
 */
export default function AdCreativeCard({
  creative,
  slotId,
  campaignId,
  orderId,
  className = "",
  imageClassName = "h-full w-full object-cover",
  showBadge = true,
  onClick,
  eager = false,
}: {
  creative: AdCreativeView;
  /** 1–10; used by the analytics event and the accessible label. */
  slotId: number;
  /** Legacy campaign id; guest PayPal placements have none. */
  campaignId?: string;
  /** Guest order id — the key a PayPal placement's measurement is stored on. */
  orderId?: string;
  className?: string;
  imageClassName?: string;
  showBadge?: boolean;
  onClick?: () => void;
  /** Load immediately instead of lazily (full-screen interstitial). */
  eager?: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [loaded, setLoaded] = useState(false);

  /**
   * Both ad models are measurable: a guest PayPal placement posts its order id
   * to `/api/track/ad`, a legacy campaign keeps the original creative endpoint.
   */
  const send = (kind: "impression" | "click") => {
    const eventId = crypto.randomUUID();
    if (orderId) {
      void fetch("/api/track/ad", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, orderId, slotId, kind }),
      }).catch(() => {});
      return;
    }
    if (!campaignId || !creative.id) return;
    void fetch(`/api/track/${kind}`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, campaignId, creativeId: creative.id, slotId }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (
      !loaded ||
      !ref.current ||
      (!orderId && (!campaignId || !creative.id)) ||
      !window.IntersectionObserver
    )
      return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    let sent = false;
    const reset = () => {
      clearTimeout(timer);
      if (
        visible &&
        !document.hidden &&
        !sent &&
        !document.querySelector('[aria-labelledby="age-gate-title"]')
      )
        timer = setTimeout(() => {
          sent = true;
          send("impression");
        }, 1000);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.intersectionRatio >= 0.5;
        reset();
      },
      { threshold: [0.5] },
    );
    observer.observe(ref.current);
    document.addEventListener("visibilitychange", reset);
    window.addEventListener("erobabe-age-declared", reset);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", reset);
      window.removeEventListener("erobabe-age-declared", reset);
    };
    // A loaded image, >=50% visible continuously for 1s in a foreground tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, campaignId, orderId, creative.id, slotId]);

  return (
    <a
      ref={ref}
      href={creative.destination_url}
      target="_blank"
      rel="noopener noreferrer nofollow sponsored"
      className={`group relative block overflow-hidden rounded-lg border border-line bg-card transition-colors duration-200 hover:border-zinc-600 ${className}`}
      aria-label={`Advertisement in slot ${slotId}: ${creative.title || "Sponsored"}`}
      onClick={() => {
        send("click");
        onClick?.();
      }}
    >
      <img
        onLoad={() => setLoaded(true)}
        src={creative.image_url}
        alt={creative.title || `Advertisement ${slotId}`}
        className={imageClassName}
        style={creativeImageStyle(creative.focus)}
        loading={eager ? "eager" : "lazy"}
      />
      {showBadge && (
        <span className="absolute left-2 top-2 flex h-4 items-center justify-center rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-300 backdrop-blur">
          Ad
        </span>
      )}
    </a>
  );
}
