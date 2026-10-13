/**
 * Provider-independent visual quality scoring for small RGB frame previews.
 * This favours detail, contrast, colour, and balanced exposure. It does not
 * identify people or scene content, and it cannot predict conversion rates.
 */
export function thumbnailFrameScore(rgb: Uint8Array, width: number, height: number): number {
  const pixels = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || rgb.length !== pixels * 3) {
    return -Infinity;
  }

  const luma = new Float32Array(pixels);
  let sum = 0;
  let squaredSum = 0;
  let saturation = 0;
  let dark = 0;
  let blown = 0;

  for (let index = 0; index < pixels; index += 1) {
    const r = rgb[index * 3];
    const g = rgb[index * 3 + 1];
    const b = rgb[index * 3 + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[index] = y;
    sum += y;
    squaredSum += y * y;
    if (y < 24) dark += 1;
    if (y > 240) blown += 1;
    const max = Math.max(r, g, b);
    saturation += max ? (max - Math.min(r, g, b)) / max : 0;
  }

  const mean = sum / pixels;
  const contrast = Math.sqrt(Math.max(0, squaredSum / pixels - mean * mean));
  const clipped = (dark + blown) / pixels;
  // Solid-colour screens, black intros, and washed-out transitions are not
  // usable thumbnails, even if their encoded JPEG happens to be large.
  if (mean < 20 || mean > 238 || contrast < 4 || clipped > 0.85) return -Infinity;

  let edgeEnergy = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const edge = 4 * luma[index] - luma[index - 1] - luma[index + 1] - luma[index - width] - luma[index + width];
      edgeEnergy += edge * edge;
    }
  }

  const detail = Math.min(1, Math.sqrt(edgeEnergy / ((width - 2) * (height - 2))) / 80);
  const exposure = 1 - Math.abs(mean - 128) / 128;
  return detail * 0.45 + Math.min(1, contrast / 64) * 0.25 + (saturation / pixels) * 0.2 + exposure * 0.1 - clipped * 0.35;
}

/** Zero-based index of the best complete RGB frame, or null if none is usable. */
export function selectThumbnailFrame(frames: Uint8Array, width: number, height: number): number | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) return null;
  const frameBytes = width * height * 3;
  const count = Math.floor(frames.length / frameBytes);
  let best: number | null = null;
  let bestScore = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const score = thumbnailFrameScore(frames.subarray(index * frameBytes, (index + 1) * frameBytes), width, height);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}
