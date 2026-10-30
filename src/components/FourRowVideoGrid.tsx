"use client";

import { Children, useRef, type ReactNode } from "react";
import {
  MAX_GRID_COLUMNS,
  gridStyle,
  useContainerColumns,
  useResponsiveGridRows,
} from "../hooks/useGridColumns";

/**
 * Shared by live catalog and demo video sections. Mobile grids show ten videos
 * vertically; wider grids retain four rows.
 *
 * Card count follows the measured width, so a shelf never shows a partial row.
 *
 * A caller may also drop one mobile-only placement into the flow (the
 * “Recommended for you” shelf does): on a one-column phone grid the extra node
 * is inserted after `mobileAdAfter` cards without displacing a video, so the
 * shelf keeps its full row count plus the banner row. On wider grids the node
 * is not rendered at all — the desktop rails own advertising there.
 */
export default function FourRowVideoGrid({
  children,
  className = "video-grid",
  columnCount,
  mobileAd,
  mobileAdAfter,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Optional **cap** on the column count (for example, the two-column Up Next
   * shelf). It can only narrow the grid: on a phone the measured width is one
   * column and no caller can force two cards side by side.
   */
  columnCount?: number;
  /** Mobile-only placement rendered inside the grid (hidden from 1000px up). */
  mobileAd?: ReactNode;
  /** Number of cards before the placement; ignored without `mobileAd`. */
  mobileAdAfter?: number;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const measuredColumns = useContainerColumns(gridRef);
  const columns = columnCount
    ? Math.min(measuredColumns, Math.max(1, Math.min(MAX_GRID_COLUMNS, Math.trunc(columnCount))))
    : measuredColumns;
  const rows = useResponsiveGridRows();
  const cards = Children.toArray(children).slice(0, columns * rows);

  // A phone shows the placement inline; a wide grid keeps its whole rows of
  // videos and leaves advertising to the rails.
  const insertAt =
    mobileAd && columns === 1
      ? Math.max(0, Math.min(Math.trunc(mobileAdAfter ?? 0), cards.length))
      : -1;
  const items =
    insertAt >= 0
      ? [...cards.slice(0, insertAt), mobileAd, ...cards.slice(insertAt)]
      : cards;

  return (
    <div
      ref={gridRef}
      className={className}
      style={gridStyle(columns)}
      data-grid-rows={rows}
      data-mobile-ad-at={insertAt >= 0 ? insertAt : undefined}
    >
      {items}
    </div>
  );
}
