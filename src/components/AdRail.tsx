import AdSlot from "./AdSlot";

interface AdRailProps {
  side: "left" | "right";
  start: number;
  count?: number;
  onAdvertise?: () => void;
}

/**
 * One vertical advertising rail. Rails are pinned to the viewport height,
 * rendered outside the scrollable center column, and hidden below the
 * desktop three-column breakpoint (1000px).
 */
export default function AdRail({ side, start, count = 5, onAdvertise }: AdRailProps) {
  const slots = Array.from({ length: count }, (_, i) => start + i);
  return (
    <aside
      aria-label={`${side === "left" ? "Left" : "Right"} advertising rail`}
      className={`hidden h-full flex-col justify-center gap-3 overflow-hidden bg-rail px-4 py-4 min-[1000px]:flex ${
        side === "left" ? "border-r border-line" : "border-l border-line"
      }`}
    >
      {slots.map((n) => (
        <AdSlot key={n} index={n} onAdvertise={onAdvertise} />
      ))}
    </aside>
  );
}
