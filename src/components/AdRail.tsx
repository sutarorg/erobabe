"use client";
import AdSlot from "./AdSlot";
import type { CreativeFocus } from "@/lib/ads/focus";

interface ActiveCampaign {
  campaign_id?: string;
  order_id?: string;
  slot_id: number;
  creative?: {
    id?: string;
    image_url?: string;
    destination_url?: string;
    title?: string;
    focus?: CreativeFocus | null;
  };
}

interface AdRailProps {
  side: "left" | "right";
  start: number;
  count?: number;
  activeCampaigns?: ActiveCampaign[];
}

/**
 * One vertical advertising rail. Rails are pinned to the viewport height,
 * rendered outside the scrollable center column, and hidden below the
 * desktop three-column breakpoint (1000px).
 */
export default function AdRail({
  side,
  start,
  count = 5,
  activeCampaigns = [],
}: AdRailProps) {
  const slots = Array.from({ length: count }, (_, i) => start + i);

  const getCreativeForSlot = (slotId: number) => {
    const campaign = activeCampaigns.find((c) => c.slot_id === slotId);
    return campaign?.creative || null;
  };

  return (
    <aside
      aria-label={`${side === "left" ? "Left" : "Right"} advertising rail`}
      className={`hidden h-full flex-col justify-center gap-3 overflow-hidden bg-rail px-4 py-4 min-[1000px]:flex ${
        side === "left" ? "border-r border-line" : "border-l border-line"
      }`}
    >
      {slots.map((n) => (
        <AdSlot
          key={`${n}:${activeCampaigns.find((c) => c.slot_id === n)?.creative?.id || "vacant"}`}
          index={n}
          campaignId={activeCampaigns.find((c) => c.slot_id === n)?.campaign_id}
          orderId={activeCampaigns.find((c) => c.slot_id === n)?.order_id}
          creative={getCreativeForSlot(n)}
        />
      ))}
    </aside>
  );
}
