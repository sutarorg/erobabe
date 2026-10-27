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

  it("rejects non-16:9 images even when they are valid PNGs", () => {
    expect(() => validateCreativeBytes(png(1000, 1000))).toThrow(CreativeValidationError);
    expect(() => validateCreativeBytes(png(1000, 1000))).toThrow(/16:9/);
  });

  it("rejects files whose bytes are not a supported image", () => {
    expect(() => validateCreativeBytes(Buffer.from("not an image"))).toThrow(/valid JPG or PNG/);
  });
});
