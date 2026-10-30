// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CreativeValidationError, validateCreativeBytes } from "@/lib/ads/creative";

function png(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  bytes.write("89504e470d0a1a0a", 0, "hex");
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("ad creative byte validation", () => {
  it("accepts a real 16:9 PNG header and records its dimensions", () => {
    const result = validateCreativeBytes(png(1200, 675));
    expect(result.fileType).toBe("image/png");
    expect(result.extension).toBe("png");
    expect(result.dimensions).toBe("1200x675");
  });

  it("accepts any aspect ratio — the placement crops it", () => {
    const square = validateCreativeBytes(png(1000, 1000));
    expect(square.dimensions).toBe("1000x1000");
    const tall = validateCreativeBytes(png(800, 1600));
    expect(tall.dimensions).toBe("800x1600");
    const wide = validateCreativeBytes(png(2000, 400));
    expect(wide.dimensions).toBe("2000x400");
  });

  it("reads an animated GIF's header", () => {
    const bytes = Buffer.alloc(16);
    bytes.write("GIF89a", 0, "ascii");
    bytes.writeUInt16LE(640, 6);
    bytes.writeUInt16LE(480, 8);
    const result = validateCreativeBytes(bytes);
    expect(result.fileType).toBe("image/gif");
    expect(result.extension).toBe("gif");
    expect(result.dimensions).toBe("640x480");
  });

  it("refuses a picture too small to fill the placement", () => {
    expect(() => validateCreativeBytes(png(40, 40))).toThrow(/at least/i);
  });

  it("refuses a picture wider than the encoder can safely handle", () => {
    expect(() => validateCreativeBytes(png(9000, 675))).toThrow(/at most/i);
  });

  it("rejects files whose bytes are not a supported image", () => {
    expect(() => validateCreativeBytes(Buffer.from("not an image"))).toThrow(/valid JPG, PNG or GIF/);
  });
});
