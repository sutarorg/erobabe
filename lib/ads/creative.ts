export const MAX_CREATIVE_BYTES = 5 * 1024 * 1024;
/** Any shape is allowed — the 16:9 placement frames it (see lib/ads/focus.ts). */
export const CREATIVE_ACCEPT = "image/jpeg,image/png,image/gif";
export const CREATIVE_TYPES = ["image/jpeg", "image/png", "image/gif"] as const;
export const CREATIVE_FORMAT_HINT = "JPG, PNG or GIF";

/** A banner thinner than this on either side cannot fill a 1160 px placement. */
const MIN_SIDE = 100;
const MAX_SIDE = 8000;
const MAX_PIXELS = 30_000_000;

export type ValidatedCreative = {
  buffer: Buffer;
  fileType: "image/jpeg" | "image/png" | "image/gif";
  extension: "jpg" | "png" | "gif";
  width: number;
  height: number;
  dimensions: string;
};

export class CreativeValidationError extends Error {}

function pngDimensions(bytes: Buffer) {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) {
    return null;
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined) break;

    // Standalone markers have no payload length.
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;

    // Start Of Frame markers (excluding DHT/JPG/DAC) carry dimensions.
    const isStartOfFrame =
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isStartOfFrame && length >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

/** GIF87a / GIF89a: dimensions are little-endian shorts at offset 6. */
function gifDimensions(bytes: Buffer) {
  if (bytes.length < 10) return null;
  const header = bytes.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  return {
    width: bytes.readUInt16LE(6),
    height: bytes.readUInt16LE(8),
  };
}

/** Validate the actual file bytes, not a browser-supplied MIME type or suffix. */
export function validateCreativeBytes(bytes: Buffer): ValidatedCreative {
  if (!bytes.length) throw new CreativeValidationError("Choose an ad banner to upload.");
  if (bytes.length > MAX_CREATIVE_BYTES) {
    throw new CreativeValidationError("Ad banner must be 5 MB or smaller.");
  }

  const png = pngDimensions(bytes);
  const jpeg = png ? null : jpegDimensions(bytes);
  const gif = png || jpeg ? null : gifDimensions(bytes);
  const dimensions = png || jpeg || gif;
  if (!dimensions) {
    throw new CreativeValidationError(
      "Ad banner must be a valid JPG, PNG or GIF image.",
    );
  }

  const { width, height } = dimensions;
  if (width < MIN_SIDE || height < MIN_SIDE) {
    throw new CreativeValidationError(
      `Ad banner must be at least ${MIN_SIDE} × ${MIN_SIDE} pixels.`,
    );
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new CreativeValidationError(
      `Ad banner must be at most ${MAX_SIDE} pixels on a side.`,
    );
  }
  // No aspect-ratio rule on purpose: the advertiser frames any shape into the
  // 16:9 placement on the checkout page, so a square or a vertical poster is
  // a valid upload.

  return {
    buffer: bytes,
    fileType: png ? "image/png" : jpeg ? "image/jpeg" : "image/gif",
    extension: png ? "png" : jpeg ? "jpg" : "gif",
    width,
    height,
    dimensions: `${width}x${height}`,
  };
}
