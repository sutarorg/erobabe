import Link from "next/link";

/**
 * The faded “Advertise with us” line printed under every mobile ad slot.
 *
 * It is a quiet, always-available route into the advertising checkout — shown
 * under a paid creative as well as under the vacant “Advertise” card, so a
 * phone visitor can buy a placement from any banner they see.
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
      className={`block text-center text-[10.5px] font-medium underline decoration-dotted underline-offset-[3px] transition-opacity duration-200 hover:opacity-100 ${
        tone === "dim" ? "text-ink-3/70 opacity-70" : "text-ink-3 opacity-75"
      } ${className}`}
    >
      Advertise with us
    </Link>
  );
}
