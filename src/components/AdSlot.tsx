import { Megaphone } from "lucide-react";

interface AdSlotProps {
  index: number;
  onAdvertise?: () => void;
}

/**
 * A vacant advertising placement on the public website.
 * Sizing (exact 16:9 that always fits five-per-viewport) is handled by
 * the `.ad-slot` class in index.css — never stretch or squash it.
 * Clicking the card sends the visitor to the advertiser create-campaign flow.
 */
export default function AdSlot({ index, onAdvertise }: AdSlotProps) {
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
    </button>
  );
}
