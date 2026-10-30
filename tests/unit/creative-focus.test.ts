import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREATIVE_FOCUS,
  cropBoxFromFocus,
  focusFromCropBox,
  moveCropBox,
  resizeCropBox,
  MAX_CREATIVE_ZOOM,
  creativeImageStyle,
  focusFromRow,
  isDefaultCreativeFocus,
  normalizeCreativeFocus,
} from "@/lib/ads/focus";

describe("creative framing", () => {
  it("centres a picture when nothing was chosen", () => {
    expect(normalizeCreativeFocus(undefined)).toEqual(DEFAULT_CREATIVE_FOCUS);
    expect(normalizeCreativeFocus({})).toEqual({ x: 50, y: 50, zoom: 1 });
    expect(isDefaultCreativeFocus(DEFAULT_CREATIVE_FOCUS)).toBe(true);
  });

  it("reads the framing a form or a database row carries as strings", () => {
    expect(normalizeCreativeFocus({ x: "12.5", y: "88", zoom: "1.75" })).toEqual({
      x: 12.5,
      y: 88,
      zoom: 1.75,
    });
    expect(focusFromRow({ focus_x: "30", focus_y: 70, focus_zoom: "2" })).toEqual({
      x: 30,
      y: 70,
      zoom: 2,
    });
  });

  it("clamps values a broken client could send", () => {
    expect(normalizeCreativeFocus({ x: -20, y: 400, zoom: 9 })).toEqual({ x: 0, y: 100, zoom: 3 });
    expect(normalizeCreativeFocus({ x: Number.NaN, y: "abc", zoom: 0 })).toEqual({
      x: 50,
      y: 50,
      zoom: 1,
    });
    expect(MAX_CREATIVE_ZOOM).toBe(3);
  });

  it("leaves the transform off when the picture is not zoomed", () => {
    const style = creativeImageStyle({ x: 50, y: 50, zoom: 1 });
    expect(style).toMatchObject({ objectFit: "cover", objectPosition: "50% 50%" });
    expect(style).not.toHaveProperty("transform");
  });

  it("zooms around the chosen point, which is what the placement renders", () => {
    const style = creativeImageStyle({ x: 20, y: 80, zoom: 1.8 });
    expect(style).toMatchObject({
      objectFit: "cover",
      objectPosition: "20% 80%",
      transform: "scale(1.8)",
      transformOrigin: "20% 80%",
    });
  });

  it("treats a frame that was only nudged as adjusted", () => {
    expect(isDefaultCreativeFocus({ x: 50, y: 50, zoom: 1.01 })).toBe(false);
    expect(isDefaultCreativeFocus({ x: 49, y: 50, zoom: 1 })).toBe(false);
  });
});

describe("the 16:9 crop window", () => {
  it("is the whole picture when the picture is already 16:9", () => {
    const box = cropBoxFromFocus(1600, 900, { x: 90, y: 10, zoom: 1 });
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.width).toBeCloseTo(1, 6);
    expect(box.height).toBeCloseTo(1, 6);
  });

  it("slides horizontally in a picture wider than 16:9", () => {
    // 3200 × 900 is 32:9, so the window covers half the width and the full height.
    const left = cropBoxFromFocus(3200, 900, { x: 0, y: 50, zoom: 1 });
    const right = cropBoxFromFocus(3200, 900, { x: 100, y: 50, zoom: 1 });
    expect(left).toMatchObject({ left: 0, top: 0 });
    expect(left.width).toBeCloseTo(0.5, 6);
    expect(left.height).toBeCloseTo(1, 6);
    expect(right.left).toBeCloseTo(0.5, 6);
  });

  it("slides vertically in a picture taller than 16:9", () => {
    const box = cropBoxFromFocus(1200, 1200, { x: 50, y: 100, zoom: 1 });
    expect(box.width).toBeCloseTo(1, 6);
    expect(box.height).toBeCloseTo(0.5625, 6);
    expect(box.top).toBeCloseTo(0.4375, 6);
    // No horizontal slack on a portrait/square picture.
    expect(box.left).toBe(0);
  });

  it("shrinks the window when the advertiser zooms in", () => {
    const wide = cropBoxFromFocus(3200, 900, { x: 50, y: 50, zoom: 2 });
    expect(wide.width).toBeCloseTo(0.25, 6);
    expect(wide.height).toBeCloseTo(0.5, 6);
    // Zoomed in around the centre: the window sits in the middle of the picture.
    expect(wide.left).toBeCloseTo(0.375, 6);
    expect(wide.top).toBeCloseTo(0.25, 6);
  });

  it("round-trips a box through the focal point that renders it", () => {
    // 0.4 wide and 0.225 high is a 16:9 window in a square picture.
    const box = { left: 0.1, top: 0.3, width: 0.4, height: 0.225 };
    const focus = focusFromCropBox(1200, 1200, box);
    const back = cropBoxFromFocus(1200, 1200, focus);
    expect(back.left).toBeCloseTo(box.left, 3);
    expect(back.top).toBeCloseTo(box.top, 3);
    expect(back.width).toBeCloseTo(box.width, 3);
    expect(back.height).toBeCloseTo(box.height, 3);
    expect(box.width / box.height).toBeCloseTo(16 / 9, 6);
  });

  it("converts a dragged window back into a focal point", () => {
    expect(focusFromCropBox(3200, 900, { left: 0.25, top: 0, width: 0.5, height: 1 })).toMatchObject({
      x: 50,
      y: 50,
    });
    expect(
      focusFromCropBox(1200, 1200, { left: 0, top: 0.4375, width: 1, height: 0.5625 }),
    ).toMatchObject({ x: 50, y: 100 });
  });

  it("keeps a 16:9 picture pannable once it is zoomed", () => {
    // At zoom 1 there is nowhere to drag; zooming in creates the slack.
    expect(
      focusFromCropBox(1600, 900, { left: 0.3, top: 0.3, width: 1, height: 1 }),
    ).toMatchObject({ x: 50, y: 50 });
    const zoomed = focusFromCropBox(1600, 900, { left: 0.25, top: 0.25, width: 0.5, height: 0.5 });
    expect(zoomed.zoom).toBeCloseTo(2, 6);
    expect(zoomed.x).toBeCloseTo(50, 6);
  });

  it("survives a picture whose size is not known yet", () => {
    expect(cropBoxFromFocus(0, 0, DEFAULT_CREATIVE_FOCUS)).toMatchObject({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    });
  });
});

describe("dragging the window", () => {
  const box = { left: 0.2, top: 0.2, width: 0.4, height: 0.4 };

  it("moves without changing size and stops at the edges", () => {
    expect(moveCropBox(box, { x: 0.1, y: -0.05 })).toMatchObject({
      left: 0.30000000000000004,
      top: 0.15000000000000002,
      width: 0.4,
      height: 0.4,
    });
    expect(moveCropBox(box, { x: 9, y: 9 })).toMatchObject({ left: 0.6, top: 0.6 });
    expect(moveCropBox(box, { x: -9, y: -9 })).toMatchObject({ left: 0, top: 0 });
  });

  it("resizes from a corner, keeping 16:9 and the opposite corner still", () => {
    const start = { left: 0.2, top: 0.2, width: 0.4, height: 0.225 };
    const bigger = resizeCropBox(1200, 1200, start, "se", { x: 0.1, y: 0.1 });
    expect(bigger.width).toBeGreaterThan(start.width);
    // In picture pixels the window stays 16:9 whatever the gesture.
    expect((bigger.width * 1200) / (bigger.height * 1200)).toBeCloseTo(16 / 9, 6);
    expect(bigger.left).toBeCloseTo(0.2, 6);
    expect(bigger.top).toBeCloseTo(0.2, 6);

    const fromTopLeft = resizeCropBox(1200, 1200, start, "nw", { x: 0.1, y: 0.1 });
    expect(fromTopLeft.left).toBeGreaterThan(start.left);
    // The bottom-right corner stays where it was.
    expect(fromTopLeft.left + fromTopLeft.width).toBeCloseTo(0.6, 6);
  });

  it("never grows past the cover crop or shrinks below the zoom cap", () => {
    const huge = resizeCropBox(1200, 1200, { left: 0, top: 0, width: 1, height: 1 }, "se", {
      x: 5,
      y: 5,
    });
    expect(huge.width).toBeCloseTo(1, 6);

    const tiny = resizeCropBox(1200, 1200, { left: 0, top: 0, width: 1, height: 1 }, "se", {
      x: -5,
      y: -5,
    });
    expect(tiny.width).toBeCloseTo(1 / 3, 6);
  });
});
