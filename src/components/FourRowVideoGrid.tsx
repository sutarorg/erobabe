"use client";

import { Children, useRef, type ReactNode } from "react";
import {
  MAX_GRID_COLUMNS,
  gridStyle,
  useContainerColumns,
  useResponsiveGridRows,
} from "../hooks/useGridColumns";

/**
 * Shared by live catalog and demo video sections. Mobile grids show one video
 * per row in a single row; wider grids retain four rows.
 *
 * Card count follows the measured width, so a shelf never shows a partial row.
 */
export default function FourRowVideoGrid({
  children,
  className = "video-grid",
  columnCount,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Optional **cap** on the column count (for example, the two-column Up Next
   * shelf). It can only narrow the grid: on a phone the measured width is one
   * column and no caller can force two cards side by side.
   */
  columnCount?: number;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const measuredColumns = useContainerColumns(gridRef);
  const columns = columnCount
    ? Math.min(measuredColumns, Math.max(1, Math.min(MAX_GRID_COLUMNS, Math.trunc(columnCount))))
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
