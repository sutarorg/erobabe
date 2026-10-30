"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import {
  MAX_CREATIVE_ZOOM,
  creativeImageStyle,
  cropBoxFromFocus,
  focusFromCropBox,
  moveCropBox,
  resizeCropBox,
  type CreativeFocus,
  type CropBox,
} from "@/lib/ads/focus";

/**
 * The four drag handles, offset by half of their own 14 px so they are centred
 * on the frame's corners. Each sits on a spot that is at most 7 px outside the
 * picture, well inside the card's padding, so no dot is ever cut off by the
 * card's border.
 */
const CORNERS = [
  { id: "nw", className: "-left-[7px] -top-[7px] cursor-nwse-resize", label: "top left" },
  { id: "ne", className: "-right-[7px] -top-[7px] cursor-nesw-resize", label: "top right" },
  { id: "sw", className: "-bottom-[7px] -left-[7px] cursor-nesw-resize", label: "bottom left" },
  { id: "se", className: "-bottom-[7px] -right-[7px] cursor-nwse-resize", label: "bottom right" },
] as const;

/**
 * The 16:9 crop window.
 *
 * Every upload lands here, whatever its shape — a square logo, a tall poster, a
 * wide strip, an animated GIF, or an exact 16:9 picture whose subject is off to
 * one side. The whole picture is shown, with the 16:9 window on top: drag the
 * window to move it, drag a corner dot to make it bigger or smaller (which is
 * the same thing as zooming the ad slot).
 *
 * The card never scrolls: it is a fixed overlay whose picture is capped to the
 * viewport, so there is no inner scrollbar on any axis.
 */
export default function CreativeCropDialog({
  open,
  src,
  fileName,
  focus,
  onDone,
  onClose,
}: {
  open: boolean;
  src: string;
  fileName: string;
  focus: CreativeFocus;
  /** Commit the framing the advertiser ended up with. */
  onDone: (next: CreativeFocus) => void;
  /** Dismiss without saving anything: the upload is discarded. */
  onClose: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState<CropBox>({ left: 0, top: 0, width: 1, height: 1 });
  const stageRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<
    | { kind: "move" | "resize"; corner?: "nw" | "ne" | "sw" | "se"; startX: number; startY: number; box: CropBox }
    | null
  >(null);

  const rebuild = useCallback(
    (nextSize: { width: number; height: number }, nextFocus: CreativeFocus) => {
      setBox(cropBoxFromFocus(nextSize.width, nextSize.height, nextFocus));
    },
    [],
  );

  // Re-open from whatever is stored for this banner.
  useEffect(() => {
    if (!open) return;
    setSize({ width: 0, height: 0 });
    setBox({ left: 0, top: 0, width: 1, height: 1 });
  }, [open, src]);

  useEffect(() => {
    if (open && size.width > 0) rebuild(size, focus);
    // `focus` is only the starting point; dragging must not re-seed the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, size.width, size.height]);

  // Focus the window so the arrow keys work at once and Escape closes.
  useEffect(() => {
    if (open) windowRef.current?.focus();
  }, [open]);

  // A full-screen overlay on a phone must not scroll the wizard behind it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const onImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const nextSize = { width: image.naturalWidth, height: image.naturalHeight };
      setSize(nextSize);
      setBox(cropBoxFromFocus(nextSize.width, nextSize.height, focus));
    },
    [focus],
  );

  /** Pointer movement in pixels → fractions of the picture. */
  function delta(event: React.PointerEvent) {
    const stage = stageRef.current?.getBoundingClientRect();
    const start = gesture.current;
    if (!start || !stage) return null;
    return {
      x: (event.clientX - start.startX) / (stage.width || 1),
      y: (event.clientY - start.startY) / (stage.height || 1),
    };
  }

  function begin(kind: "move" | "resize", event: React.PointerEvent) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.stopPropagation();
    gesture.current = {
      kind,
      corner: kind === "resize" ? (event.currentTarget as HTMLElement).dataset.corner as
        | "nw"
        | "ne"
        | "sw"
        | "se" : undefined,
      startX: event.clientX,
      startY: event.clientY,
      box,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function move(event: React.PointerEvent) {
    const start = gesture.current;
    const offset = delta(event);
    if (!start || !offset) return;
    setBox(
      start.kind === "resize" && start.corner
        ? resizeCropBox(size.width, size.height, start.box, start.corner, offset)
        : moveCropBox(start.box, offset),
    );
  }

  function end() {
    gesture.current = null;
  }

  function nudge(dx: number, dy: number) {
    setBox((current) => moveCropBox(current, { x: dx, y: dy }));
  }

  if (!open) return null;

  // How much the window is zoomed in, as a percentage: the label a screen
  // reader gets while a corner is being dragged.
  const baseWidth =
    size.width > 0 && size.height > 0
      ? cropBoxFromFocus(size.width, size.height, { x: 50, y: 50, zoom: 1 }).width
      : 0;
  const frameStyle = {
    left: `${box.left * 100}%`,
    top: `${box.top * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
  const zoomPercent =
    baseWidth > 0 && box.width > 0
      ? Math.min(
          Math.round(MAX_CREATIVE_ZOOM * 100),
          Math.max(100, Math.round((baseWidth / box.width) * 100)),
        )
      : 100;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-black/85 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-dialog-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      {/* overflow-hidden, fixed height budget: the card itself never scrolls. */}
      <div className="flex max-h-[92dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_32px_90px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <h2 id="crop-dialog-title" className="truncate text-[13.5px] font-semibold text-ink">
            Frame your banner
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition hover:bg-white/10 hover:text-ink"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          {/* Exactly the picture's box: every percentage below is a percentage
              of the image, which is what the crop maths expects. The stage
              itself does not clip — only the picture layer does — so the corner
              dots stay visible even when the window sits on the image edge. */}
          <div ref={stageRef} className="relative inline-block max-w-full select-none">
            <div className="relative overflow-hidden rounded-lg">
              <img
                src={src}
                alt=""
                onLoad={onImageLoad}
                draggable={false}
                className="block h-auto w-auto max-w-full opacity-90"
                style={{ maxHeight: "calc(92dvh - 9rem)" }}
              />
              {/* Dim everything outside the window. The 9999px spread is clipped
                  by the picture layer above, never by the card. */}
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-[3px] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                style={frameStyle}
              />
            </div>

            {/* The frame and its four drag handles live outside the clipped
                picture layer, so no handle can be cut off by the card edge. */}
            <div
              ref={windowRef}
              role="group"
              aria-label="16:9 crop window. Drag it, resize it from a corner, or use the arrow keys."
              tabIndex={0}
              onPointerDown={(event) => begin("move", event)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 0.1 : 0.02;
                if (event.key === "ArrowLeft") nudge(-step, 0);
                else if (event.key === "ArrowRight") nudge(step, 0);
                else if (event.key === "ArrowUp") nudge(0, -step);
                else if (event.key === "ArrowDown") nudge(0, step);
                else return;
                event.preventDefault();
              }}
              className="absolute cursor-move touch-none rounded-[3px] border-2 border-accent outline-none focus-visible:border-white"
              style={frameStyle}
            >
              <span aria-hidden className="pointer-events-none absolute inset-0">
                <span className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
                <span className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
                <span className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
                <span className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
              </span>

              {/* Four corner dots: drag any of them to resize the window, which
                  is how the advertiser zooms into the part they want. They are
                  inset by half their own size so the whole dot stays inside the
                  card's rounded border. */}
              {CORNERS.map((corner) => (
                <span
                  key={corner.id}
                  role="slider"
                  tabIndex={0}
                  aria-label={`Resize from the ${corner.label} corner`}
                  aria-valuemin={100}
                  aria-valuemax={Math.round(MAX_CREATIVE_ZOOM * 100)}
                  aria-valuenow={zoomPercent}
                  aria-valuetext={`${zoomPercent}% zoom`}
                  data-corner={corner.id}
                  onPointerDown={(event) => begin("resize", event)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 0.1 : 0.02;
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      setBox((current) =>
                        resizeCropBox(size.width, size.height, current, corner.id, {
                          x: step,
                          y: step,
                        }),
                      );
                    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      setBox((current) =>
                        resizeCropBox(size.width, size.height, current, corner.id, {
                          x: -step,
                          y: -step,
                        }),
                      );
                    } else return;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  className={`absolute z-10 h-3.5 w-3.5 touch-none rounded-full border-2 border-white bg-accent shadow-[0_1px_4px_rgba(0,0,0,0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${corner.className}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 pb-4 pt-1">
          <p className="truncate text-[10.5px] text-ink-3">{fileName}</p>
          <button
            type="button"
            onClick={() => {
              if (size.width > 0) onDone(focusFromCropBox(size.width, size.height, box));
              else onDone(focus);
            }}
            className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-white transition hover:bg-accent-soft"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The uploaded banner, framed exactly as the ad slot will show it.
 *
 * Tapping the picture reopens the crop window; the delete button lives in the
 * corner so removing the upload is one tap away and never confused with the
 * frame itself.
 */
export function CreativeThumb({
  src,
  fileName,
  dimensions,
  focus,
  onAdjust,
  onRemove,
}: {
  src: string;
  fileName: string;
  dimensions: string;
  focus: CreativeFocus;
  onAdjust: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-xl border border-accent/40 bg-black">
      <button
        type="button"
        onClick={onAdjust}
        title="Adjust the 16:9 frame"
        aria-label="Adjust the 16:9 frame"
        className="block h-full w-full cursor-pointer"
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full"
          style={creativeImageStyle(focus)}
        />
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Delete banner"
        title="Delete banner"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white backdrop-blur transition hover:bg-red-600 hover:text-white"
      >
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
      </button>

      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2.5 pt-8 text-[10.5px]">
        <span className="max-w-[62%] truncate">{fileName}</span>
        <span className="shrink-0 text-emerald-300">{dimensions || "Any shape"}</span>
      </span>
    </div>
  );
}
