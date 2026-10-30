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

/** The smallest window an advertiser may drag down to (matches the zoom cap). */
export const MIN_CROP_FRACTION = 1 / MAX_CREATIVE_ZOOM;

/**
 * Where the 16:9 window sits inside a picture, as fractions of the picture.
 *
 * The window may be as large as the biggest 16:9 rectangle that fits (the
 * "cover" crop, which leaves slack on one axis only) or as small as a third of
 * that, and it can be dragged anywhere that keeps it inside the picture. The
 * live placement renders exactly this rectangle, so the frame picked here is
 * the crop a visitor gets.
 */
export type CropBox = { left: number; top: number; width: number; height: number };

/** Largest 16:9 window that fits in the picture, at zoom 1. */
function baseCrop(width: number, height: number) {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const imageAspect = width / height;
  return imageAspect >= AD_ASPECT
    ? { width: AD_ASPECT / imageAspect, height: 1 }
    : { width: 1, height: imageAspect / AD_ASPECT };
}

/**
 * The window for a stored focus.
 *
 * `creativeImageStyle` scales the 16:9 picture around its focal point, which
 * shows a window of `base / zoom` centred in the way `object-position` works;
 * these two functions are the exact inverse of that, so the rectangle drawn on
 * screen and the crop rendered in the ad slot can never disagree.
 */
export function cropBoxFromFocus(
  width: number,
  height: number,
  focus: CreativeFocus | null | undefined,
): CropBox {
  const base = baseCrop(width, height);
  const { x, y, zoom } = normalizeCreativeFocus(focus);
  const boxWidth = base.width / zoom;
  const boxHeight = base.height / zoom;
  // How far the origin point travels once the picture is scaled.
  const travelX = (1 - base.width) + base.width * ((zoom - 1) / zoom);
  const travelY = (1 - base.height) + base.height * ((zoom - 1) / zoom);
  const left = (x / 100) * travelX;
  const top = (y / 100) * travelY;
  return {
    left: Math.min(Math.max(left, 0), 1 - boxWidth),
    top: Math.min(Math.max(top, 0), 1 - boxHeight),
    width: boxWidth,
    height: boxHeight,
  };
}

/**
 * The focal point and zoom that render exactly this window.
 *
 * The width decides the zoom and the height follows from the picture's shape,
 * so a box can never be stored as a rectangle the placement cannot render.
 */
export function focusFromCropBox(
  width: number,
  height: number,
  box: CropBox,
): CreativeFocus {
  const base = baseCrop(width, height);
  if (!(base.width > 0) || !(base.height > 0)) return DEFAULT_CREATIVE_FOCUS;
  const boxWidth = clamp(box.width, base.width * MIN_CROP_FRACTION, base.width);
  const boxHeight = boxWidth * (base.height / base.width);
  const boxLeft = clamp(box.left, 0, Math.max(0, 1 - boxWidth));
  const boxTop = clamp(box.top, 0, Math.max(0, 1 - boxHeight));
  const zoom = clamp(base.width / boxWidth, 1, MAX_CREATIVE_ZOOM);
  const travelX = (1 - base.width) + base.width * ((zoom - 1) / zoom);
  const travelY = (1 - base.height) + base.height * ((zoom - 1) / zoom);
  return normalizeCreativeFocus({
    x: travelX > 0 ? (boxLeft / travelX) * 100 : 50,
    y: travelY > 0 ? (boxTop / travelY) * 100 : 50,
    zoom,
  });
}

/**
 * One corner drag, in picture fractions.
 *
 * The window keeps 16:9 while it is resized, the opposite corner stays put,
 * and it never grows past the cover crop or shrinks below the zoom cap.
 */
export function resizeCropBox(
  width: number,
  height: number,
  start: CropBox,
  corner: "nw" | "ne" | "sw" | "se",
  delta: { x: number; y: number },
): CropBox {
  const base = baseCrop(width, height);
  const minWidth = base.width * MIN_CROP_FRACTION;
  // A fraction of width per fraction of height: the window's own aspect.
  const ratio = base.height / base.width;

  const growX = corner === "ne" || corner === "se" ? delta.x : -delta.x;
  const growY = corner === "se" || corner === "sw" ? delta.y : -delta.y;
  // Average the two axes so a diagonal drag feels the same as a straight one.
  const nextWidth = clamp(start.width + (growX + growY / ratio) / 2, minWidth, base.width);
  const nextHeight = nextWidth * ratio;

  return {
    width: nextWidth,
    height: nextHeight,
    left:
      corner === "nw" || corner === "sw"
        ? clamp(start.left + start.width - nextWidth, 0, 1 - nextWidth)
        : clamp(start.left, 0, 1 - nextWidth),
    top:
      corner === "nw" || corner === "ne"
        ? clamp(start.top + start.height - nextHeight, 0, 1 - nextHeight)
        : clamp(start.top, 0, 1 - nextHeight),
  };
}

/** Keep a dragged window inside the picture without changing its size. */
export function moveCropBox(box: CropBox, delta: { x: number; y: number }): CropBox {
  return {
    ...box,
    left: clamp(box.left + delta.x, 0, Math.max(0, 1 - box.width)),
    top: clamp(box.top + delta.y, 0, Math.max(0, 1 - box.height)),
  };
}
