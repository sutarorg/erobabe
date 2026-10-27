"use client";
import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Measure before the first paint on the client, and do nothing extra on the
 * server. A plain `useEffect` would show two columns for one frame on a phone
 * before the measurement narrowed the grid to one.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Desktop video sections are four rows tall; mobile sections are one row. */
export const GRID_ROWS = 4;
export const MOBILE_GRID_ROWS = 1;
export const MAX_GRID_COLUMNS = 4;

/**
 * Below this container width a video section is a single column.
 *
 * It is the same 28rem `@md` container-query breakpoint the Tailwind-driven
 * listing grids start from (`grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3
 * @2xl:grid-cols-4`), so a measured shelf and a class-driven listing always
 * switch together — one video per row on a phone, never two cards squeezed
 * side by side.
 */
export const MOBILE_GRID_BREAKPOINT = 448;

/** Viewport width that both grid hooks treat as "mobile". */
export const MOBILE_VIEWPORT_QUERY = "(max-width: 767px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, [query]);

  return matches;
}

/** Shared responsive row count for every fixed video shelf. */
export function useResponsiveGridRows(): number {
  return useMediaQuery(MOBILE_VIEWPORT_QUERY) ? MOBILE_GRID_ROWS : GRID_ROWS;
}

/** Comfortable minimum card width and the grid's horizontal gap, in px. */
const MIN_CARD_WIDTH = 168;
const GAP = 14;

/** One column on a phone, then as many whole columns as comfortably fit. */
function columnsFor(width: number): number {
  if (width < MOBILE_GRID_BREAKPOINT) return 1;
  for (let c = MAX_GRID_COLUMNS; c >= 2; c--) {
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
  // Two columns is what the server renders (and what a wide desktop keeps), so
  // hydration has nothing to correct. The measurement below narrows a phone to
  // one column before it paints.
  const [columns, setColumns] = useState(2);

  useIsomorphicLayoutEffect(() => {
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
  const value = Math.trunc(columns);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(MAX_GRID_COLUMNS, value);
}

/** Item count for a complete four-row grid; a five-column mode is never used. */
export const gridItemCount = (columns: number): number => clampColumns(columns) * GRID_ROWS;

/** Inline style carrying the live column count. */
export const gridStyle = (columns: number): CSSProperties => ({
  gridTemplateColumns: `repeat(${clampColumns(columns)}, minmax(0, 1fr))`,
});
