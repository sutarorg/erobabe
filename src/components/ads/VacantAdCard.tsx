import Link from "next/link";
import { Megaphone } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The unsold placement card — the same design on the homepage rails, in the
 * mobile banners and inside the checkout slot picker.
 *
 * It renders a plain link by default, or a button when `onSelect` is supplied
 * (the checkout picker never reloads the page). Both forms carry the same
 * visual design, so a visitor recognises the placement everywhere.
 */
export default function VacantAdCard({
  slotId,
  className = "",
  label = "Advertise",
  note = "View pricing",
  emphasize = false,
  onSelect,
  tag,
  meta,
  badge,
  disabled = false,
  compact = false,
  children,
}: {
  /** Slot number to preselect on the checkout page; omitted = let them choose. */
  slotId?: number;
  className?: string;
  label?: string;
  note?: string;
  /** The checkout picker highlights the card as a selectable option. */
  emphasize?: boolean;
  /** When provided the card is a button (used inside the checkout wizard). */
  onSelect?: () => void;
  /** Small pill in the top-left corner, e.g. “Available”. */
  tag?: string;
  /** Small caption under the label, e.g. “Slot 3 · $99.00”. */
  meta?: string;
  badge?: ReactNode;
  disabled?: boolean;
  /** Tight 16:9 cards (the checkout picker) drop the caption line. */
  compact?: boolean;
  children?: ReactNode;
}) {
  const classes = `group relative flex flex-col items-center justify-center overflow-hidden rounded-lg border bg-card transition-colors duration-200 ${
    compact ? "gap-0.5" : "gap-1.5"
  } ${
    emphasize
      ? "border-accent/45 hover:border-accent hover:bg-card-hover"
      : "border-accent/35 hover:border-accent/70 hover:bg-card-hover"
  } ${disabled ? "pointer-events-none opacity-50" : ""} ${className}`;

  const contents = (
    <>
      {tag && (
        <span className="absolute left-1.5 top-1.5 rounded-full border border-accent/40 bg-accent/12 px-1.5 py-[1px] text-[8.5px] font-semibold uppercase tracking-wider text-accent">
          {tag}
        </span>
      )}
      {badge}
      <span
        className={`flex items-center justify-center rounded-full border border-accent/30 bg-accent/10 transition-colors group-hover:border-accent/60 group-hover:bg-accent/20 ${
          compact ? "h-5 w-5" : "h-7 w-7"
        }`}
      >
        <Megaphone
          className={compact ? "h-3 w-3 text-accent" : "h-3.5 w-3.5 text-accent"}
          strokeWidth={1.9}
          aria-hidden
        />
      </span>
      <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-200 transition-colors group-hover:text-white">
        {label}
      </span>
      {!compact && <span className="text-[10px] text-ink-3">{note}</span>}
      {meta && <span className="text-[9px] tabular-nums text-ink-3">{meta}</span>}
      {children}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={`${classes} cursor-pointer`}
        aria-label={
          slotId
            ? `Select ad slot ${slotId} — 16:9 placement`
            : "Select an advertising placement"
        }
      >
        {contents}
      </button>
    );
  }

  return (
    <Link
      href={slotId ? `/checkout?slot=${slotId}` : "/checkout"}
      prefetch
      className={classes}
      aria-label={
        slotId
          ? `Advertise in slot ${slotId} — 16:9 placement`
          : "Advertise on erobabe — 16:9 placement"
      }
    >
      {contents}
    </Link>
  );
}
