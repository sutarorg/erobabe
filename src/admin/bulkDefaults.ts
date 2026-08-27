/* ──────────────────────────────────────────────────────────────
 * Defaults applied automatically during a bulk upload.
 *
 * In bulk mode the admin only edits the title and thumbnail; every
 * other field is generated here so 20 uploads stay consistent without
 * 20 rounds of manual data entry.
 * ────────────────────────────────────────────────────────────── */

/**
 * Twenty stock descriptions, assigned sequentially across a batch so
 * consecutive uploads never share identical copy (which reads as
 * duplicate content to search engines).
 */
export const DEFAULT_DESCRIPTIONS: string[] = [
  "Stream this full-length 18+ video in high quality on EroBabe. Smooth playback, no interruptions, and fresh adult content added every day.",
  "Watch this premium adult video online in crisp HD. EroBabe delivers fast streaming, clean playback and a constantly updated library for adults.",
  "A standout scene from the EroBabe collection, streaming now in high definition. Discover more trending 18+ videos across every category.",
  "Enjoy this full 18+ video with fast, buffer-free streaming on EroBabe. Browse thousands of related clips hand-picked for adult viewers.",
  "This adult video is available to stream in high quality, free and instantly. Explore the EroBabe catalog for more from this category.",
  "Now streaming on EroBabe — a complete adult scene in sharp quality, optimized for both mobile and desktop viewing.",
  "One of the most-watched uploads in this category. Stream the full 18+ video on EroBabe with quick load times and clean video quality.",
  "Watch the full version of this adult video online. EroBabe brings you daily uploads, trending scenes and effortless HD streaming.",
  "A fresh addition to the EroBabe library, streaming now in high definition. Find more like it in the related and recommended sections.",
  "Premium 18+ content, streaming free on EroBabe. Fast servers, high-quality video and new scenes published throughout the week.",
  "Stream this complete adult scene in high quality. EroBabe keeps playback smooth on every device, with no sign-up required to watch.",
  "Trending right now on EroBabe. Watch this full-length 18+ video and explore related content from the same category and tags.",
  "Newly uploaded to EroBabe and streaming in HD. Browse our full adult catalog for more scenes matching your taste.",
  "This full adult video streams instantly in high quality. Discover thousands more 18+ videos organized by category on EroBabe.",
  "Watch online in high definition on EroBabe — the complete scene, fast loading, and personalized recommendations after every video.",
  "Featured in the EroBabe collection. Stream this 18+ video in full quality and keep watching with automatically suggested related scenes.",
  "High-quality adult streaming, available now. This full video plays smoothly on mobile and desktop, with more uploads added daily.",
  "Part of the growing EroBabe library. Watch the complete 18+ video in HD and browse similar content in the recommended section below.",
  "Stream this popular adult video free in high definition. EroBabe organizes every scene by category and tag so you always find more.",
  "Watch this full 18+ scene online in premium quality. Fast, clean streaming on EroBabe with fresh content published every single day.",
];

/** Pick the description for position `index` in a batch, cycling if needed. */
export const descriptionForIndex = (index: number): string =>
  DEFAULT_DESCRIPTIONS[index % DEFAULT_DESCRIPTIONS.length];

/** Search-engine title derived from the video title. */
export function generateSeoTitle(title: string): string {
  const clean = String(title || "Video").replace(/\s+/g, " ").trim();
  const suffix = " | Watch Free 18+ Video on EroBabe";
  // Search engines truncate around 60–70 characters; stay under the DB cap.
  const room = 150 - suffix.length;
  return `${clean.length > room ? `${clean.slice(0, room).trim()}…` : clean}${suffix}`;
}

/** SEO description derived from the assigned default description. */
export const generateSeoDescription = (description: string): string =>
  description.replace(/\s+/g, " ").trim().slice(0, 300);

/** Tidy a filename into a human title: "my_clip-01.mp4" → "My Clip 01". */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return base
    .split(" ")
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ")
    .slice(0, 120);
}

/** Videos are released one per hour, starting an hour after the batch finishes. */
export const PUBLISH_INTERVAL_MS = 60 * 60 * 1000;

export function scheduleForIndex(index: number, base = Date.now()): Date {
  return new Date(base + (index + 1) * PUBLISH_INTERVAL_MS);
}
