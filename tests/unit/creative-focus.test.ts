import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREATIVE_FOCUS,
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
