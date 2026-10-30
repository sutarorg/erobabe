import Link from "next/link";

/**
 * The faded “Advertise with us” line printed under every mobile ad slot.
 *
 * It is a quiet route into the advertising checkout — shown under a paid
 * creative as well as under the vacant “Advertise” card, so a phone visitor can
 * buy a placement from any banner they see. It sits a step below the card text
 * in weight but stays clearly legible on a phone (`text-ink-2` at 90%).
 */
export default function AdvertiseWithUsLink({
  className = "",
  tone = "muted",
}: {
  className?: string;
  /** `muted` on the page background, `dim` inside a dark overlay. */
  tone?: "muted" | "dim";
}) {
  return (
    <Link
      href="/checkout"
      prefetch
      className={`block text-center text-[10.5px] font-medium underline decoration-dotted underline-offset-[3px] transition-colors duration-200 ${
        tone === "dim" ? "text-ink-2/75 hover:text-ink-2" : "text-ink-2/90 hover:text-ink"
      } ${className}`}
    >
      Advertise with us
    </Link>
  );
}
