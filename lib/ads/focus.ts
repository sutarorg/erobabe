import type { CSSProperties } from "react";

/**
 * How a creative sits inside its 16:9 placement.
 *
 * An advertiser can upload any shape — a square, a tall poster, a wide strip,
 * an animated GIF — so the placement needs to know which part of that picture
 * matters. `x`/`y` are percentages of the image (the same values CSS
 * `object-position` takes) and `zoom` scales the framed picture around them.
 *
 * The checkout preview and the live placement both render through
 * `creativeImageStyle`, which is why what an advertiser adjusts is exactly what
 * a visitor sees.
 */
export type CreativeFocus = {
  x: number;
  y: number;
  zoom: number;
};

export const DEFAULT_CREATIVE_FOCUS: CreativeFocus = { x: 50, y: 50, zoom: 1 };

/** Above 3× the creative is a smear of pixels, not a picture. */
export const MAX_CREATIVE_ZOOM = 3;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Coerce anything (form strings, a jsonb column, a legacy row without the
 * column at all) into a usable focus. Never throws: a broken value degrades to
 * a centred, unzoomed frame.
 */
export function normalizeCreativeFocus(input: unknown): CreativeFocus {
  const source = (input ?? {}) as Partial<Record<keyof CreativeFocus, unknown>>;
  const x = asNumber(source.x);
  const y = asNumber(source.y);
  const zoom = asNumber(source.zoom);
  return {
    x: Math.round(clamp(x ?? DEFAULT_CREATIVE_FOCUS.x, 0, 100) * 10) / 10,
    y: Math.round(clamp(y ?? DEFAULT_CREATIVE_FOCUS.y, 0, 100) * 10) / 10,
    zoom: Math.round(clamp(zoom ?? DEFAULT_CREATIVE_FOCUS.zoom, 1, MAX_CREATIVE_ZOOM) * 100) / 100,
  };
}

/** True when the advertiser left the frame alone (nothing to persist). */
export function isDefaultCreativeFocus(focus: CreativeFocus): boolean {
  return focus.x === 50 && focus.y === 50 && focus.zoom === 1;
}

/**
 * The CSS that frames a picture inside a 16:9 box: cover-crop, then zoom
 * around the chosen point. The parent element owns the clipping.
 */
export function creativeImageStyle(focus: CreativeFocus | null | undefined): CSSProperties {
  const { x, y, zoom } = normalizeCreativeFocus(focus);
  return {
    objectFit: "cover",
    objectPosition: `${x}% ${y}%`,
    ...(zoom === 1
      ? {}
      : { transform: `scale(${zoom})`, transformOrigin: `${x}% ${y}%` }),
  };
}

/** Read a focus out of a flat row (database columns or form fields). */
export function focusFromRow(row: {
  focus_x?: unknown;
  focus_y?: unknown;
  focus_zoom?: unknown;
}): CreativeFocus {
  return normalizeCreativeFocus({
    x: row.focus_x,
    y: row.focus_y,
    zoom: row.focus_zoom,
  });
}

/** The placement's shape: a 16:9 box, whatever the creative's own shape is. */
export const AD_ASPECT = 16 / 9;

/**
 * Where the 16:9 window sits inside a picture, as fractions of the picture.
 *
 * The window is always the largest 16:9 rectangle that fits, which is exactly
 * what `object-fit: cover` shows in the placement. A picture wider than 16:9
 * leaves horizontal slack only; a taller one leaves vertical slack only; an
 * exact 16:9 picture leaves none, because the window is the whole picture.
 */
export type CropBox = { left: number; top: number; width: number; height: number };

export function cropBoxFor(
  width: number,
  height: number,
  focus: CreativeFocus | null | undefined,
): CropBox {
  if (!(width > 0) || !(height > 0)) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  const imageAspect = width / height;
  const wider = imageAspect > AD_ASPECT;
  const boxWidth = wider ? AD_ASPECT / imageAspect : 1;
  const boxHeight = wider ? 1 : imageAspect / AD_ASPECT;
  const { x, y } = normalizeCreativeFocus(focus);
  return {
    left: (x / 100) * (1 - boxWidth),
    top: (y / 100) * (1 - boxHeight),
    width: boxWidth,
    height: boxHeight,
  };
}

/**
 * The inverse: after the window is dragged to `left`/`top` (fractions of the
 * picture), what focal point does that represent? Slack-free axes keep the
 * default, because there is nowhere to drag on them.
 */
export function focusFromCropBox(
  width: number,
  height: number,
  box: { left: number; top: number },
  zoom = 1,
): CreativeFocus {
  const current = cropBoxFor(width, height, DEFAULT_CREATIVE_FOCUS);
  const slackX = 1 - current.width;
  const slackY = 1 - current.height;
  return normalizeCreativeFocus({
    x: slackX > 0 ? (box.left / slackX) * 100 : 50,
    y: slackY > 0 ? (box.top / slackY) * 100 : 50,
    zoom,
  });
}
