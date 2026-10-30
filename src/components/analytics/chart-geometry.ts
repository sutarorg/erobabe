"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shared geometry for the analytics charts.
 *
 * Both charts used to draw into a fixed `720 × h` viewBox while being stretched
 * to the panel width. `preserveAspectRatio` then letter-boxed the drawing: the
 * plot no longer filled its box (the empty bands above and below the columns on
 * the delivery card), and the pointer maths — which multiplied by the CSS width
 * — pointed at the wrong bucket the further you moved from the centre.
 *
 * Measuring the container and drawing in its own pixel space removes both
 * problems at once: one SVG unit is one CSS pixel, so the crosshair lands
 * exactly under the cursor and the plot fills the card.
 */
export function useMeasuredWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      // A hidden or unmounted panel measures 0: keep the last good width rather
      // than collapsing the chart.
      if (next > 0) setWidth((current) => (current === next ? current : next));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export function clamp(value: number, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.min(Math.max(value, low), high);
}

/**
 * Round axis steps: 0, 250, 500, 750, 1000 rather than 0, 233, 466, 699.
 *
 * The top tick is the axis maximum, so a series that peaks at 9 reads against a
 * 10 line instead of being clipped to its own value.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rough = max / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  // Every series this dashboard plots is a count, so a step below 1 would only
  // ever produce duplicate labels: keep the axis whole.
  const step = Math.max(
    1,
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude,
  );
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Math.round(value));
  return ticks;
}

/**
 * Which buckets get an x-axis label.
 *
 * Fitting every label of a 90-day range would overlap into a grey smear, so the
 * number of labels follows the available width and the chosen indices are
 * spread evenly — the first and last bucket always keep a label.
 */
export function tickIndices(count: number, innerWidth: number, minGap = 62): number[] {
  if (count <= 1) return [0];
  const maxLabels = clamp(Math.floor(innerWidth / minGap) + 1, 2, 8);
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);
  const step = (count - 1) / (maxLabels - 1);
  return Array.from(new Set(Array.from({ length: maxLabels }, (_, index) => Math.round(index * step))));
}

/** The bucket under the pointer, in user units. */
export function nearestIndex(px: number, left: number, step: number, count: number): number {
  if (count <= 1) return 0;
  return clamp(Math.round((px - left) / (step || 1)), 0, count - 1);
}
