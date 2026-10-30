// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clamp, nearestIndex, niceTicks, tickIndices } from "@/src/components/analytics/chart-geometry";

describe("axis ticks", () => {
  it("rounds the axis to readable steps", () => {
    expect(niceTicks(9, 4).at(-1)).toBe(10);
    expect(niceTicks(37, 4)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(1200, 4)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(3, 4)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0.4, 4).at(-1)).toBeGreaterThanOrEqual(0.4);
  });

  it("always starts at zero and never clips the peak", () => {
    for (const max of [1, 7, 43, 999, 12345]) {
      const ticks = niceTicks(max, 4);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(max);
    }
  });

  it("survives nonsense input", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(-5)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });
});

describe("x-axis labels", () => {
  it("labels every bucket when they fit", () => {
    expect(tickIndices(5, 500)).toEqual([0, 1, 2, 3, 4]);
  });

  it("thins a long range and keeps both ends", () => {
    const indices = tickIndices(90, 578);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(89);
    expect(indices.length).toBeLessThanOrEqual(8);
    // Evenly spread, never duplicated.
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("handles a single bucket", () => {
    expect(tickIndices(1, 300)).toEqual([0]);
  });
});

describe("pointer to bucket", () => {
  it("picks the nearest bucket, clamped to the plot", () => {
    const left = 46;
    const step = 100;
    expect(nearestIndex(46, left, step, 10)).toBe(0);
    expect(nearestIndex(96, left, step, 10)).toBe(1);
    expect(nearestIndex(146, left, step, 10)).toBe(1);
    expect(nearestIndex(-500, left, step, 10)).toBe(0);
    expect(nearestIndex(5000, left, step, 10)).toBe(9);
  });

  it("collapses a one-bucket chart", () => {
    expect(nearestIndex(400, 46, 0, 1)).toBe(0);
  });

  it("clamps both ways", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    // Inverted bounds are normalised rather than returning nonsense.
    expect(clamp(5, 10, 0)).toBe(5);
  });
});
