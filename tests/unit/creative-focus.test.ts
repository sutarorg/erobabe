import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREATIVE_FOCUS,
  cropBoxFor,
  focusFromCropBox,
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
    const box = cropBoxFor(1600, 900, { x: 90, y: 10, zoom: 1 });
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box).toMatchObject({ width: 1, height: 1 });
  });

  it("slides horizontally in a picture wider than 16:9", () => {
    // 3200 × 900 is 32:9, so the window covers half the width and the full height.
    const left = cropBoxFor(3200, 900, { x: 0, y: 50, zoom: 1 });
    const right = cropBoxFor(3200, 900, { x: 100, y: 50, zoom: 1 });
    expect(left).toMatchObject({ left: 0, top: 0, width: 0.5, height: 1 });
    expect(right.left).toBeCloseTo(0.5, 6);
  });

  it("slides vertically in a picture taller than 16:9", () => {
    const box = cropBoxFor(1200, 1200, { x: 50, y: 100, zoom: 1 });
    expect(box.width).toBe(1);
    expect(box.height).toBeCloseTo(0.5625, 6);
    expect(box.top).toBeCloseTo(0.4375, 6);
    // No horizontal slack on a portrait/square picture.
    expect(box.left).toBe(0);
  });

  it("converts a dragged window back into a focal point", () => {
    expect(focusFromCropBox(3200, 900, { left: 0.25, top: 0 })).toMatchObject({ x: 50, y: 50 });
    expect(focusFromCropBox(1200, 1200, { left: 0, top: 0.4375 })).toMatchObject({ x: 50, y: 100 });
    // An exact 16:9 picture has nowhere to drag, so it stays centred.
    expect(focusFromCropBox(1600, 900, { left: 0.3, top: 0.3 })).toMatchObject({ x: 50, y: 50 });
  });

  it("survives a picture whose size is not known yet", () => {
    expect(cropBoxFor(0, 0, DEFAULT_CREATIVE_FOCUS)).toEqual({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    });
  });
});
