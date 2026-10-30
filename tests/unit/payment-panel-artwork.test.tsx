import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PaymentPanel from "@/app/checkout/PaymentPanel";
import {
  PAYMENT_PANEL_ARTWORK_FALLBACK,
  PAYMENT_PANEL_ARTWORK_HEIGHT,
  PAYMENT_PANEL_ARTWORK_PATH,
  PAYMENT_PANEL_ARTWORK_SIZES,
  PAYMENT_PANEL_ARTWORK_SMALL_PATH,
  PAYMENT_PANEL_ARTWORK_SMALL_WIDTH,
  PAYMENT_PANEL_ARTWORK_WIDTH,
  PAYMENT_PANEL_ASPECT,
} from "@/lib/ads/payment";

const PUBLIC_DIR = path.join(process.cwd(), "public");

/** Width and height straight out of a PNG's IHDR chunk. */
function pngSize(file: string) {
  const buffer = readFileSync(path.join(PUBLIC_DIR, file));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Files are cached under a `?v=` URL; the disk path is what matters here. */
function onDisk(url: string) {
  return url.replace(/^\//, "").split("?")[0];
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
    expect(existsSync(path.join(PUBLIC_DIR, onDisk(PAYMENT_PANEL_ARTWORK_PATH)))).toBe(true);
    expect(existsSync(path.join(PUBLIC_DIR, onDisk(PAYMENT_PANEL_ARTWORK_FALLBACK)))).toBe(true);
    const png = pngSize(onDisk(PAYMENT_PANEL_ARTWORK_FALLBACK));
    const webp = webpSize(onDisk(PAYMENT_PANEL_ARTWORK_PATH));

    expect(png).toEqual({ width: 960, height: 1080 });
    expect(webp).toEqual({ width: 960, height: 1080 });
    // 960 × 1080 is 8:9, which is the panel's shape.
    expect(png.width / png.height).toBeCloseTo(8 / 9, 6);
    expect(PAYMENT_PANEL_ASPECT).toBe("8 / 9");
    expect({ width: PAYMENT_PANEL_ARTWORK_WIDTH, height: PAYMENT_PANEL_ARTWORK_HEIGHT }).toEqual(
      png,
    );
  });

  it("ships a phone-sized WebP variant that is still 8:9", () => {
    const small = webpSize(onDisk(PAYMENT_PANEL_ARTWORK_SMALL_PATH));
    expect(small.width).toBe(PAYMENT_PANEL_ARTWORK_SMALL_WIDTH);
    expect(small.width / small.height).toBeCloseTo(8 / 9, 3);

    const bytes = readFileSync(path.join(PUBLIC_DIR, onDisk(PAYMENT_PANEL_ARTWORK_SMALL_PATH))).length;
    expect(bytes).toBeLessThan(30 * 1024);
    expect(PAYMENT_PANEL_ARTWORK_SIZES).toContain("min-width: 1024px");
  });

  it("offers both WebP sizes through one srcset", () => {
    const html = renderToStaticMarkup(<PaymentPanel />);
    expect(html).toContain(`${PAYMENT_PANEL_ARTWORK_SMALL_WIDTH}w`);
    expect(html).toContain(`${PAYMENT_PANEL_ARTWORK_WIDTH}w`);
    expect(html).toContain("sizes=");
  });

  it("ships a WebP that is much smaller than the PNG fallback", () => {
    const webp = readFileSync(path.join(PUBLIC_DIR, onDisk(PAYMENT_PANEL_ARTWORK_PATH)));
    const png = readFileSync(path.join(PUBLIC_DIR, onDisk(PAYMENT_PANEL_ARTWORK_FALLBACK)));
    expect(webp.length).toBeLessThan(png.length / 2);
  });

  it("never points the panel at a third-party image host", () => {
    const html = renderToStaticMarkup(<PaymentPanel />);
    expect(html).not.toContain("i.ibb.co");
    expect(html).not.toContain("postimg");
    expect(html).toContain(PAYMENT_PANEL_ARTWORK_PATH);
    expect(html).toContain(PAYMENT_PANEL_ARTWORK_FALLBACK);
  });

  it("is cached for a year under a versioned URL", () => {
    // The URL carries a version so the immutable cache can never serve stale art.
    expect(PAYMENT_PANEL_ARTWORK_PATH).toMatch(/\?v=\d+$/);
    expect(PAYMENT_PANEL_ARTWORK_FALLBACK).toMatch(/\?v=\d+$/);

    const config = readFileSync(path.join(process.cwd(), "next.config.mjs"), "utf8");
    for (const file of ["/checkout/advertise-panel.webp", "/checkout/advertise-panel.png"]) {
      expect(config).toContain(`source: '${file}'`);
    }
    expect(config).toContain("max-age=31536000, immutable");
  });

  it("paints the artwork from the first render instead of after hydration", () => {
    const html = renderToStaticMarkup(<PaymentPanel />);
    // The bug this guards: the picture used to start at `opacity-0` and only
    // became visible once a client-side onLoad ran after hydration, so a fully
    // downloaded image could sit invisible while the JS bundle booted.
    expect(html).not.toMatch(/opacity-0/);
    expect(html).toMatch(/<img[^>]*fetchpriority="high"/i);
    expect(html).toMatch(/<img[^>]*loading="eager"/i);
  });

  it("sits on the bottom of the panel on every breakpoint", () => {
    const html = renderToStaticMarkup(<PaymentPanel />);
    expect(html).toContain("items-end");
    expect(html).not.toContain("items-center");
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
