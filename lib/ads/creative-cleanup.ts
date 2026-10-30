/**
 * Removing a finished advertisement's banner.
 *
 * Every order stores its creative twice: the file in the `ad-creatives` bucket
 * and the public URL on the order row. Leaving a rejected or expired banner in
 * place is not just clutter — the file stays publicly readable by URL for ever,
 * and the slot's record keeps pointing at an ad that will never run again.
 *
 * `releaseAdCreative` deletes the file and clears both columns in one place, so
 * "rejected", "expired" and a manual delete all behave the same way. The order
 * row itself is kept: it is the revenue history the dashboard and payments
 * screens rely on.
 */

type ServiceClient = {
  from: (table: string) => any;
  storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<{ error: unknown }> } };
};

export type ReleasedCreative = {
  orderId: string;
  /** The storage object that was asked to delete itself, if the row had one. */
  path: string | null;
  /** Did the bucket confirm the deletion (or was there nothing to delete)? */
  removed: boolean;
  /** The order row whose image columns were cleared. */
  cleared: boolean;
};

/** Storage objects live in this bucket; see `app/api/ads/submit/route.ts`. */
export const AD_CREATIVE_BUCKET = "ad-creatives";

/**
 * Deletes one order's banner file and blanks its image columns.
 *
 * A storage failure is reported, not thrown: a file that cannot be removed is
 * not a reason to keep showing an ad that has already been rejected or has run
 * out, and the caller usually has a user waiting.
 */
export async function releaseAdCreative(
  service: ServiceClient,
  order: { id: string; image_path?: string | null; image_url?: string | null },
): Promise<ReleasedCreative> {
  const path = order.image_path || null;
  let removed = true;

  if (path) {
    try {
      const { error } = await service.storage.from(AD_CREATIVE_BUCKET).remove([path]);
      removed = !error;
      if (error) console.error("Ad creative removal failed", path);
    } catch (error) {
      removed = false;
      console.error("Ad creative removal failed", error);
    }
  }

  // Even if the bucket refused, the row must stop advertising the file: the
  // public pages and the checkout read `image_url`, not the object itself.
  let cleared = true;
  try {
    const { error: updateError } = await service
      .from("ad_orders")
      .update({ image_url: null, image_path: null })
      .eq("id", order.id);
    if (updateError) throw updateError;
  } catch (error) {
    cleared = false;
    console.error("Ad creative reference cleanup failed", error);
  }

  return { orderId: order.id, path, removed, cleared };
}

/**
 * Banners that must not stay in the bucket: rejected orders, and live orders
 * whose window has closed.
 *
 * `graceMs` keeps a banner for a short while after expiry so a late click on a
 * cached page cannot land on a 404 mid-session.
 */
export async function releaseFinishedCreatives(
  service: ServiceClient,
  options: { now?: Date; graceMs?: number; limit?: number } = {},
): Promise<ReleasedCreative[]> {
  const now = options.now ?? new Date();
  const graceMs = options.graceMs ?? 2 * 24 * 60 * 60 * 1000;
  const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
  const cutoff = new Date(now.getTime() - graceMs).toISOString();

  const released: ReleasedCreative[] = [];

  // Rejected: permanently out, banner or no banner.
  const { data: rejected, error: rejectedError } = await service
    .from("ad_orders")
    .select("id, image_path, image_url")
    .eq("status", "rejected")
    .not("image_path", "is", null)
    .limit(limit);
  if (rejectedError) console.error("Rejected ad sweep failed", rejectedError.code);

  // Expired: the paid window ended (plus a short grace).
  const { data: expired, error: expiredError } = await service
    .from("ad_orders")
    .select("id, image_path, image_url, ends_at")
    .in("status", ["live", "paused"])
    .not("image_path", "is", null)
    .lt("ends_at", cutoff)
    .limit(limit);
  if (expiredError) console.error("Expired ad sweep failed", expiredError.code);

  const seen = new Set<string>();
  for (const order of [...(rejected || []), ...(expired || [])] as Array<{
    id: string;
    image_path?: string | null;
    image_url?: string | null;
  }>) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    released.push(await releaseAdCreative(service, order));
  }

  return released;
}
