"use client";

import { Children, useRef, type ReactNode } from "react";
import {
  MAX_GRID_COLUMNS,
  gridStyle,
  useContainerColumns,
  useResponsiveGridRows,
} from "../hooks/useGridColumns";

/**
 * Shared by live catalog and demo video sections. Mobile grids show exactly
 * two rows; wider grids retain four. Card count follows measured width.
 */
export default function FourRowVideoGrid({
  children,
  className = "video-grid",
  columnCount,
}: {
  children: ReactNode;
  className?: string;
  /** Optional fixed column count (for example, the two-column Up Next shelf). */
  columnCount?: number;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const measuredColumns = useContainerColumns(gridRef);
  const columns = columnCount
    ? Math.max(2, Math.min(MAX_GRID_COLUMNS, Math.trunc(columnCount)))
    : measuredColumns;
  const rows = useResponsiveGridRows();
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
