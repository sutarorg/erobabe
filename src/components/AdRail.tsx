"use client";
import AdSlot from "./AdSlot";

interface ActiveCampaign {
  slot_id: number;
  creative?: {
    image_url?: string;
    destination_url?: string;
    title?: string;
  };
}

interface AdRailProps {
  side: "left" | "right";
  start: number;
  count?: number;
  onAdvertise?: () => void;
  activeCampaigns?: ActiveCampaign[];
}

/**
 * One vertical advertising rail. Rails are pinned to the viewport height,
 * rendered outside the scrollable center column, and hidden below the
 * desktop three-column breakpoint (1000px).
 */
export default function AdRail({ side, start, count = 5, onAdvertise, activeCampaigns = [] }: AdRailProps) {
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
        <AdSlot key={n} index={n} onAdvertise={onAdvertise} creative={getCreativeForSlot(n)} />
      ))}
    </aside>
  );
}
