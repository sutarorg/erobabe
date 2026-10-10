"use client";
import { Megaphone } from "lucide-react";

interface AdSlotProps {
  index: number;
  onAdvertise?: () => void;
  creative?: {
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
export default function AdSlot({ index, onAdvertise, creative }: AdSlotProps) {
  if (creative?.image_url && creative?.destination_url && isSafeUrl(creative.destination_url)) {
    return (
      <a
        href={creative.destination_url}
        target="_blank"
        rel="noopener noreferrer nofollow sponsored"
        className="ad-slot group relative overflow-hidden rounded-lg border border-line bg-card transition-colors duration-200 hover:border-zinc-600"
        aria-label={`Advertisement in slot ${index}: ${creative.title || "Sponsored"}`}
        onClick={() => {
          // Real impression/click tracking would be handled via API
          fetch("/api/track/click", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slotId: index, creativeTitle: creative.title }),
          }).catch(() => {});
        }}
      >
        <img
          src={creative.image_url}
          alt={creative.title || `Advertisement ${index}`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <span className="absolute left-2 top-2 flex h-4 min-w-4 items-center justify-center rounded bg-black/60 px-1 text-[9px] font-semibold tabular-nums text-zinc-300 backdrop-blur">
          Ad {index}
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
      <span className="absolute left-2 top-2 flex h-4 min-w-4 items-center justify-center rounded bg-accent/12 px-1 text-[9px] font-semibold tabular-nums text-accent">
        {index}
      </span>
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent/10 transition-colors group-hover:border-accent/60 group-hover:bg-accent/20">
        <Megaphone className="h-3.5 w-3.5 text-accent" strokeWidth={1.9} aria-hidden />
      </span>
      <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-200 transition-colors group-hover:text-white">
        Advertise
      </span>
      <span className="text-[10px] text-ink-3">$99/mo</span>
    </button>
  );
}
