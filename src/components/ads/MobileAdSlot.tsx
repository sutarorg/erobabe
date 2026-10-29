"use client";

import { cn } from "@/src/utils/cn";
import AdCreativeCard, { isSafeAdUrl } from "./AdCreativeCard";
import VacantAdCard from "./VacantAdCard";
import { useMobileAds } from "./MobileAdsProvider";

/**
 * One 16:9 mobile advertising banner.
 *
 * Phones have no side rails, so the same ten paid creatives are re-used as
 * in-flow banners: after the home shelves, every eighth video in the listings
 * and between the watch-page sections. The creative is chosen by the visitor's
 * own rotation (`MobileAdsProvider`), never by the position on the page, so no
 * advertiser owns "the first banner".
 *
 * The banner is hidden from 1000px up — that is where the desktop rails take
 * over — and `display:none` also removes it from a grid, so a desktop layout
 * gains no empty cells. When no ad is active the plain “Advertise” card shows,
 * exactly as the rails do.
 */
export default function MobileAdSlot({
  position,
  inGrid = false,
  className = "",
  eager = false,
}: {
  /** Global banner index on the page — drives the rotation and analytics slot. */
  position: number;
  /** Inserted as a full-width row inside a video grid. */
  inGrid?: boolean;
  className?: string;
  eager?: boolean;
}) {
  const { adAt } = useMobileAds();
  const ad = adAt(position);
  const slotId = (Math.abs(position) % 10) + 1;
  const showCreative = Boolean(ad?.image_url && isSafeAdUrl(ad.destination_url));

  return (
    <div
      className={cn(
        "min-[1000px]:hidden",
        inGrid ? "col-span-full" : "my-6",
        className,
      )}
      data-mobile-ad={position}
    >
      <div className="relative w-full overflow-hidden rounded-xl">
        {showCreative && ad ? (
          <AdCreativeCard
            creative={ad}
            slotId={slotId}
            campaignId={ad.campaign_id}
            className="aspect-video w-full rounded-xl"
            imageClassName="h-full w-full object-cover"
            eager={eager}
          />
        ) : (
          <VacantAdCard className="aspect-video w-full rounded-xl" />
        )}
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-300 backdrop-blur">
          Advertisement
        </span>
      </div>
    </div>
  );
}
