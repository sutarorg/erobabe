"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { GRID_ROWS, gridStyle, useContainerColumns } from "../hooks/useGridColumns";

/**
 * Shared by the live catalog and demo video sections. Mobile grids show two
 * rows; wider grids retain the four-row layout. The visible card count follows
 * the measured container width so each section stays within its row limit.
 */
export default function FourRowVideoGrid({
  children,
  className = "video-grid",
}: {
  children: ReactNode;
  className?: string;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useContainerColumns(gridRef);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const updateMobile = () => setIsMobile(mobileQuery.matches);
    updateMobile();
    mobileQuery.addEventListener("change", updateMobile);
    return () => mobileQuery.removeEventListener("change", updateMobile);
  }, []);

  const rows = isMobile ? 2 : GRID_ROWS;
  const cards = Children.toArray(children).slice(0, columns * rows);

  return (
    <div
      ref={gridRef}
      className={className}
      style={gridStyle(columns)}
      data-grid-rows={rows}
    >
      {cards}
    </div>
  );
}
