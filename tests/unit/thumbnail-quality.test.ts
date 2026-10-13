import { describe, expect, it } from "vitest";
import { selectThumbnailFrame, thumbnailFrameScore } from "@/lib/video/thumbnail-quality";

const WIDTH = 16;
const HEIGHT = 16;

function frame(pixel: (x: number, y: number) => number[]): Buffer {
  return Buffer.from(Array.from({ length: WIDTH * HEIGHT }, (_, index) => pixel(index % WIDTH, Math.floor(index / WIDTH))).flat());
}

const colourful = frame((x, y) => (x + y) % 2 ? [230, 160, 40] : [30, 60, 180]);
const grayscale = frame((x, y) => (x + y) % 2 ? [167, 167, 167] : [62, 62, 62]);
const blurry = frame((x) => [60 + x * 8, 60 + x * 8, 60 + x * 8]);
const dark = frame((x, y) => (x + y) % 2 ? [3, 3, 3] : [12, 12, 12]);
const blown = frame((x, y) => (x + y) % 2 ? [245, 245, 245] : [254, 254, 254]);

describe("thumbnail visual quality scoring", () => {
  it("rejects black, near-black, blown-out, and flat-colour frames", () => {
    for (const pixels of [Buffer.alloc(WIDTH * HEIGHT * 3), dark, blown, frame(() => [30, 150, 200])]) {
      expect(thumbnailFrameScore(pixels, WIDTH, HEIGHT)).toBe(-Infinity);
    }
  });

  it("prefers a detailed, colourful frame over a blurred or desaturated one", () => {
    expect(thumbnailFrameScore(colourful, WIDTH, HEIGHT)).toBeGreaterThan(thumbnailFrameScore(blurry, WIDTH, HEIGHT));
    expect(thumbnailFrameScore(colourful, WIDTH, HEIGHT)).toBeGreaterThan(thumbnailFrameScore(grayscale, WIDTH, HEIGHT));
  });

  it("selects the best frame rather than the first or an average frame", () => {
    const frames = Buffer.concat([dark, blurry, grayscale, colourful, blown]);
    expect(selectThumbnailFrame(frames, WIDTH, HEIGHT)).toBe(3);
  });

  it("returns no candidate when every frame is unusable", () => {
    expect(selectThumbnailFrame(Buffer.concat([dark, blown]), WIDTH, HEIGHT)).toBeNull();
  });

  it("breaks ties deterministically and ignores a partial trailing frame", () => {
    expect(selectThumbnailFrame(Buffer.concat([colourful, colourful, dark.subarray(0, 20)]), WIDTH, HEIGHT)).toBe(0);
  });

  it("rejects invalid dimensions and incomplete pixels", () => {
    expect(thumbnailFrameScore(colourful.subarray(0, 10), WIDTH, HEIGHT)).toBe(-Infinity);
    expect(selectThumbnailFrame(colourful, 0, HEIGHT)).toBeNull();
    expect(selectThumbnailFrame(colourful, 1.5, HEIGHT)).toBeNull();
  });
});
