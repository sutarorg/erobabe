import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1_234_000 → "1.2M", 523_000 → "523K" */
export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${trim1(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function trim1(n: number) {
  return n.toFixed(1).replace(/\.0$/, "");
}

/** 754 seconds → "12:34" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** 2 → "2 days ago" · 9 → "1 week ago" · 40 → "1 month ago" */
export function timeAgo(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return w === 1 ? "1 week ago" : `${w} weeks ago`;
  }
  const m = Math.round(days / 30);
  return m <= 1 ? "1 month ago" : `${m} months ago`;
}

/** Full readable date for a "days ago" offset, e.g. "Jan 12, 2026". */
export function fullDate(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Liked percentage for display. Values below 10% keep one decimal so a
 * realistic like rate (typically a few percent of viewers) doesn't collapse
 * to a round "3%" and lose all meaning.
 */
export function formatPercent(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 10) return n.toFixed(1).replace(/\.0$/, "");
  return String(Math.round(n));
}
