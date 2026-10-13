"use client";

import { Children, useRef, type ReactNode } from "react";
import { GRID_ROWS, gridItemCount, gridStyle, useContainerColumns } from "../hooks/useGridColumns";

/**
 * Shared by the live catalog and demo video sections. Both the column count
 * and visible card count follow the container's width, so narrowing a panel
 * cannot turn four rows into five. Wide panels never exceed four columns.
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
  const cards = Children.toArray(children).slice(0, gridItemCount(columns));

  return (
    <div ref={gridRef} className={className} style={gridStyle(columns)} data-grid-rows={GRID_ROWS}>
      {cards}
    </div>
  );
}
