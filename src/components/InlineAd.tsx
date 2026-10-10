import { Megaphone } from "lucide-react";

/**
 * In-content advertising placement, shown only when the vertical
 * side rails are hidden (tablet & mobile layouts). Exact 16:9 ratio.
 */
export default function InlineAd({ onAdvertise }: { onAdvertise?: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdvertise}
      aria-label="Advertise with erobabe — 16:9 placement"
      className="group relative flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-accent/35 bg-card transition-colors hover:border-accent/70 min-[1000px]:hidden"
    >
      <span className="absolute left-2 top-2 flex h-4 items-center justify-center rounded bg-accent/12 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
        Ad
      </span>
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-accent/10 transition-colors group-hover:bg-accent/20">
        <Megaphone className="h-4 w-4 text-accent" strokeWidth={1.9} aria-hidden />
      </span>
      <span className="text-[12.5px] font-semibold text-zinc-100">Advertise</span>
      <span className="text-[10.5px] text-ink-3">Reach our audience — from $99/month</span>
    </button>
  );
}
