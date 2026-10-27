import type { PublicVideo } from "./catalog";
/** Newest entries stay in Latest. Featured selects established, most-viewed
 * entries from the remainder; never repeats the same catalog row. */
export function homeSections(videos: PublicVideo[]) {
  const sorted = [...videos].sort((a, b) =>
    String(b.published_at || "").localeCompare(String(a.published_at || "")),
  );
  const latestCount = Math.min(sorted.length, 16, Math.max(10, Math.ceil(sorted.length / 2)));
  const latest = sorted.slice(0, latestCount);
  const ids = new Set(latest.map((v) => v.slug));
  const featured = sorted
    .filter((v) => !ids.has(v.slug))
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 16);
  return { latest, featured };
}
