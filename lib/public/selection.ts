import type { PublicVideo } from "./catalog";
/** Newest entries stay in Latest. Featured selects established, most-viewed
 * entries from the remainder; never repeats the same catalog row. */
export function homeSections(videos: PublicVideo[]) {
  const sorted = [...videos].sort((a, b) =>
    String(b.published_at || "").localeCompare(String(a.published_at || "")),
  );
  const latest = sorted.slice(0, Math.min(16, Math.ceil(sorted.length / 2)));
  const ids = new Set(latest.map((v) => v.slug));
  const featured = sorted
    .filter((v) => !ids.has(v.slug))
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 16);
  return { latest, featured };
}
