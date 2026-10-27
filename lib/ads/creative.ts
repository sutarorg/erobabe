export const MAX_CREATIVE_BYTES = 5 * 1024 * 1024;
export const CREATIVE_ACCEPT = "image/jpeg,image/png";

export type ValidatedCreative = {
  buffer: Buffer;
  fileType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
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

/** Validate the actual file bytes, not a browser-supplied MIME type or suffix. */
export function validateCreativeBytes(bytes: Buffer): ValidatedCreative {
  if (!bytes.length) throw new CreativeValidationError("Choose an ad banner to upload.");
  if (bytes.length > MAX_CREATIVE_BYTES) {
    throw new CreativeValidationError("Ad banner must be 5 MB or smaller.");
  }

  const png = pngDimensions(bytes);
  const jpeg = png ? null : jpegDimensions(bytes);
  const dimensions = png || jpeg;
  if (!dimensions) {
    throw new CreativeValidationError("Ad banner must be a valid JPG or PNG image.");
  }

  const { width, height } = dimensions;
  if (width < 1 || height < 1 || width > 20000 || height > 20000) {
    throw new CreativeValidationError("Ad banner dimensions are invalid.");
  }

  // Permit tiny rounding differences from design tools while retaining a 16:9 canvas.
  if (Math.abs(width / height - 16 / 9) > 0.01) {
    throw new CreativeValidationError("Ad banner must use a 16:9 aspect ratio (1200 × 675 recommended).");
  }

  return {
    buffer: bytes,
    fileType: png ? "image/png" : "image/jpeg",
    extension: png ? "png" : "jpg",
    width,
    height,
    dimensions: `${width}x${height}`,
  };
}
