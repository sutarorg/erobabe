"use client";
import { useEffect, useState, type CSSProperties, type RefObject } from "react";

/** Every video section is exactly four rows tall. */
export const GRID_ROWS = 4;
export const MAX_GRID_COLUMNS = 4;

/** Comfortable minimum card width and the grid's horizontal gap, in px. */
const MIN_CARD_WIDTH = 168;
const GAP = 14;

function columnsFor(width: number): number {
  for (let c = MAX_GRID_COLUMNS; c >= 3; c--) {
    if (width >= c * MIN_CARD_WIDTH + (c - 1) * GAP) return c;
  }
  return 2;
}

/**
 * Measures the grid element and returns how many whole columns actually fit.
 *
 * The public site renders inside a center panel that is only ~60% of the
 * viewport, so viewport-based breakpoints routinely disagreed with the real
 * available width. Measuring the element itself fixes that, and because the
 * result is applied inline as `grid-template-columns`, the CSS and the
 * rendered item count share a single source of truth and cannot drift apart.
 */
export function useContainerColumns(
  ref: RefObject<HTMLElement | null>
): number {
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => setColumns(columnsFor(el.clientWidth));
    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);

  return columns;
}

function clampColumns(columns: number): number {
  return Math.max(2, Math.min(MAX_GRID_COLUMNS, Math.trunc(columns) || 2));
}

/** Item count for a complete four-row grid; a five-column mode is never used. */
export const gridItemCount = (columns: number): number => clampColumns(columns) * GRID_ROWS;

/** Inline style carrying the live column count. */
export const gridStyle = (columns: number): CSSProperties => ({
  gridTemplateColumns: `repeat(${clampColumns(columns)}, minmax(0, 1fr))`,
});
