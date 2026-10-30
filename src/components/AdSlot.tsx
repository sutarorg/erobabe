"use client";
import AdCreativeCard, { isSafeAdUrl } from "./ads/AdCreativeCard";
import type { CreativeFocus } from "@/lib/ads/focus";
import VacantAdCard from "./ads/VacantAdCard";

interface AdSlotProps {
  index: number;
  campaignId?: string;
  /** Guest PayPal order occupying the placement, when there is one. */
  orderId?: string;
  creative?: {
    id?: string;
    image_url?: string;
    destination_url?: string;
    title?: string;
    focus?: CreativeFocus | null;
  } | null;
}

/**
 * A desktop rail placement on the public website.
 * Sizing (exact 16:9 that always fits five-per-viewport) is handled by
 * the `.ad-slot` class — never stretch or squash it.
 * If an approved creative exists, render it; otherwise show the vacant card.
 */
export default function AdSlot({ index, creative, campaignId, orderId }: AdSlotProps) {
  if (
    creative?.image_url &&
    creative?.destination_url &&
    isSafeAdUrl(creative.destination_url)
  ) {
    return (
      <AdCreativeCard
        creative={creative}
        slotId={index}
        campaignId={campaignId}
        orderId={orderId}
        className="ad-slot"
      />
    );
  }

  return <VacantAdCard slotId={index} className="ad-slot" />;
}
