/**
 * Even, per-visitor ad rotation for the mobile placements.
 *
 * The ten paid placements are a shared pool: on the desktop rails slot 1–10
 * always shows the creative bought for that slot, but a phone has no rails —
 * banners are injected between video rows instead. A phone must not pin one
 * advertiser to "the first banner" for everybody, so the pool is shuffled with
 * a per-visitor seed and cycled across the banner positions.
 *
 * Cycling (`position % pool.length`) guarantees the two properties the product
 * asks for:
 *
 *  - every active ad is shown with the same priority — `n` ads spread evenly
 *    over the banner positions, never favouring the first creative;
 *  - a single active ad fills every banner position (positions are only empty
 *    when the pool itself is empty, and then the plain "Advertise" card shows).
 *
 * Everything here is a pure function of the pool and the seed, so the server
 * render and the browser hydration agree.
 */

export type RotatableAd = {
  /** Stable creative id; also used as the React key. */
  id: string;
  /** Analytics campaign id — only legacy campaigns have one. */
  campaign_id?: string;
  title: string;
  image_url: string;
  destination_url: string;
};

/** FNV-1a — small, fast, and stable across server and browser. */
export function hashSeed(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by `seededRandom`. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = seededRandom(hashSeed(seed));
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

/**
 * Rotation seed for one visitor.
 *
 * A stored visitor token keeps the order stable while navigating, and the UTC
 * date makes it rotate once a day so a regular visitor does not stare at the
 * same first banner forever.
 */
export function rotationSeed(visitorToken?: string | null, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const visitor = (visitorToken || "").trim() || "erobabe-visitor";
  return `${visitor}:${day}`;
}

/** Only creatives that can actually be rendered are part of the rotation. */
export function rotatableAds(ads: readonly RotatableAd[]): RotatableAd[] {
  const seen = new Set<string>();
  return ads.filter((ad) => {
    if (!ad?.id || !ad.image_url || !ad.destination_url) return false;
    if (!/^https?:\/\//i.test(ad.destination_url)) return false;
    if (!/^https?:\/\//i.test(ad.image_url)) return false;
    if (seen.has(ad.id)) return false;
    seen.add(ad.id);
    return true;
  });
}

/** The visitor-specific display order of the pool. */
export function orderedAds(ads: readonly RotatableAd[], seed: string): RotatableAd[] {
  return seededShuffle(rotatableAds(ads), seed);
}

/**
 * The creative shown at one banner position.
 *
 * `position` is a global counter of banner placements on the page, so an
 * interstitial and an in-feed banner never show the same creative side by side
 * when more than one ad is active.
 */
export function adForPosition(
  ads: readonly RotatableAd[],
  position: number,
): RotatableAd | null {
  if (!ads.length) return null;
  const index = ((Math.trunc(position) % ads.length) + ads.length) % ads.length;
  return ads[index] ?? null;
}

/** The first `count` banner positions, resolved in order. */
export function adsForPositions(
  ads: readonly RotatableAd[],
  count: number,
  offset = 0,
): Array<RotatableAd | null> {
  return Array.from({ length: Math.max(0, Math.trunc(count)) }, (_, index) =>
    adForPosition(ads, offset + index),
  );
}
