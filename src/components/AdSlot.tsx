"use client";
import { useEffect, useRef, useState } from "react";
import { Megaphone } from "lucide-react";

interface AdSlotProps {
  index: number;
  campaignId?: string;
  onAdvertise?: () => void;
  creative?: {
    id?: string;
    image_url?: string;
    destination_url?: string;
    title?: string;
  } | null;
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * A advertising placement on the public website.
 * Sizing (exact 16:9 that always fits five-per-viewport) is handled by
 * the `.ad-slot` class — never stretch or squash it.
 * If creative exists and is approved, render it; otherwise show vacant state.
 */
export default function AdSlot({
  index,
  onAdvertise,
  creative,
  campaignId,
}: AdSlotProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [loaded, setLoaded] = useState(false);
  const send = (kind: "impression" | "click") => {
    if (!campaignId || !creative?.id) return;
    void fetch(`/api/track/${kind}`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        campaignId,
        creativeId: creative.id,
        slotId: index,
      }),
    }).catch(() => {});
  };
  useEffect(() => {
    if (
      !loaded ||
      !ref.current ||
      !campaignId ||
      !creative?.id ||
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
  }, [loaded, campaignId, creative?.id, index]);
  if (
    creative?.image_url &&
    creative?.destination_url &&
    isSafeUrl(creative.destination_url)
  ) {
    return (
      <a
        ref={ref}
        href={creative.destination_url}
        target="_blank"
        rel="noopener noreferrer nofollow sponsored"
        className="ad-slot group relative overflow-hidden rounded-lg border border-line bg-card transition-colors duration-200 hover:border-zinc-600"
        aria-label={`Advertisement in slot ${index}: ${creative.title || "Sponsored"}`}
        onClick={() => send("click")}
      >
        <img
          onLoad={() => setLoaded(true)}
          src={creative.image_url}
          alt={creative.title || `Advertisement ${index}`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <span className="absolute left-2 top-2 flex h-4 items-center justify-center rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-300 backdrop-blur">
          Ad
        </span>
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onAdvertise}
      className="ad-slot group relative flex flex-col items-center justify-center gap-1.5 rounded-lg border border-accent/35 bg-card transition-colors duration-200 hover:border-accent/70 hover:bg-card-hover"
      aria-label={`Advertise in slot ${index} — 16:9 placement`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent/10 transition-colors group-hover:border-accent/60 group-hover:bg-accent/20">
        <Megaphone
          className="h-3.5 w-3.5 text-accent"
          strokeWidth={1.9}
          aria-hidden
        />
      </span>
      <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-200 transition-colors group-hover:text-white">
        Advertise
      </span>
      <span className="text-[10px] text-ink-3">View pricing</span>
    </button>
  );
}
