import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PaymentPanel from "@/app/checkout/PaymentPanel";
import {
  PAYMENT_PANEL_ARTWORK_FALLBACK,
  PAYMENT_PANEL_ARTWORK_HEIGHT,
  PAYMENT_PANEL_ARTWORK_PATH,
  PAYMENT_PANEL_ARTWORK_WIDTH,
  PAYMENT_PANEL_ASPECT,
} from "@/lib/ads/payment";

const PUBLIC_DIR = path.join(process.cwd(), "public");

/** Width and height straight out of a PNG's IHDR chunk. */
function pngSize(file: string) {
  const buffer = readFileSync(path.join(PUBLIC_DIR, file));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Canvas size from a WebP file's VP8/VP8L/VP8X chunk. */
function webpSize(file: string) {
  const buffer = readFileSync(path.join(PUBLIC_DIR, file));
  expect(buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return {
    width: buffer.readUInt16LE(26) & 0x3fff,
    height: buffer.readUInt16LE(28) & 0x3fff,
  };
}

describe("checkout right-hand artwork", () => {
  it("is a real 8:9 file, committed next to the app", () => {
    expect(existsSync(path.join(PUBLIC_DIR, PAYMENT_PANEL_ARTWORK_PATH))).toBe(true);
    const png = pngSize(PAYMENT_PANEL_ARTWORK_FALLBACK.replace(/^\//, ""));
    const webp = webpSize(PAYMENT_PANEL_ARTWORK_PATH.replace(/^\//, ""));

    expect(png).toEqual({ width: 960, height: 1080 });
    expect(webp).toEqual({ width: 960, height: 1080 });
    // 960 × 1080 is 8:9, which is the panel's shape.
    expect(png.width / png.height).toBeCloseTo(8 / 9, 6);
    expect(PAYMENT_PANEL_ASPECT).toBe("8 / 9");
    expect({ width: PAYMENT_PANEL_ARTWORK_WIDTH, height: PAYMENT_PANEL_ARTWORK_HEIGHT }).toEqual(
      png,
    );
  });

  it("ships a WebP that is much smaller than the PNG fallback", () => {
    const webp = readFileSync(path.join(PUBLIC_DIR, PAYMENT_PANEL_ARTWORK_PATH.replace(/^\//, "")));
    const png = readFileSync(path.join(PUBLIC_DIR, PAYMENT_PANEL_ARTWORK_FALLBACK.replace(/^\//, "")));
    expect(webp.length).toBeLessThan(png.length / 2);
  });

  it("never points the panel at a third-party image host", () => {
    const html = renderToStaticMarkup(<PaymentPanel />);
    expect(html).not.toContain("i.ibb.co");
    expect(html).not.toContain("postimg");
    expect(html).toContain(PAYMENT_PANEL_ARTWORK_PATH);
    expect(html).toContain(PAYMENT_PANEL_ARTWORK_FALLBACK);
  });

  it("renders in an 8:9 frame, filled edge to edge", () => {
    const html = renderToStaticMarkup(<PaymentPanel />);
    expect(html).toContain("aspect-ratio:8 / 9");
    expect(html).toContain("object-cover");
    // The intrinsic size is declared so the frame never reflows as it loads.
    expect(html).toContain('width="960"');
    expect(html).toContain('height="1080"');
    expect(html).toContain("fetchPriority");
  });
});
