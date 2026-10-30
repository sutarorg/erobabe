"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import {
  creativeImageStyle,
  cropBoxFor,
  focusFromCropBox,
  normalizeCreativeFocus,
  type CreativeFocus,
} from "@/lib/ads/focus";

/**
 * The 16:9 crop picker.
 *
 * Banners arrive in every shape — a square logo, a tall poster, a wide strip,
 * an animated GIF — and even an exact 16:9 picture may have its subject off to
 * one side. So every upload opens this: the whole picture, with the 16:9
 * window laid over it. Drag the window to choose what the ad slot shows.
 *
 * The window is the largest 16:9 rectangle that fits, which is precisely what
 * `object-fit: cover` shows in the placement, so the frame approved here is the
 * crop a visitor gets — no zoom, no second guess.
 */
export default function CreativeCropDialog({
  open,
  src,
  fileName,
  focus,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  src: string;
  fileName: string;
  focus: CreativeFocus;
  onConfirm: (next: CreativeFocus) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CreativeFocus>(focus);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; box: { left: number; top: number } } | null>(
    null,
  );

  // Start each visit from the framing that is already stored.
  useEffect(() => {
    if (open) setDraft(focus);
  }, [open, focus]);

  // Focus moves into the frame so the arrow keys work immediately and Escape
  // can close the sheet without hunting for it first.
  useEffect(() => {
    if (open) windowRef.current?.focus();
  }, [open]);

  // A full-screen sheet on a phone must not scroll the wizard behind it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const box = cropBoxFor(size.width, size.height, draft);

  const onImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setSize({ width: image.naturalWidth, height: image.naturalHeight });
  }, []);

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      box: { left: box.left, top: box.top },
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Remembered so pointermove can convert pixels to fractions of the stage.
    stage.dataset.dragWidth = String(rect.width || 1);
    stage.dataset.dragHeight = String(rect.height || 1);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    const stage = stageRef.current;
    if (!start || !stage) return;
    const width = Number(stage.dataset.dragWidth) || 1;
    const height = Number(stage.dataset.dragHeight) || 1;
    const nextLeft = Math.min(
      Math.max(start.box.left + (event.clientX - start.startX) / width, 0),
      1 - box.width,
    );
    const nextTop = Math.min(
      Math.max(start.box.top + (event.clientY - start.startY) / height, 0),
      1 - box.height,
    );
    setDraft(
      focusFromCropBox(size.width, size.height, { left: nextLeft, top: nextTop }),
    );
  }

  function endDrag() {
    drag.current = null;
  }

  /** The window only moves on an axis that has slack; arrows do the same. */
  function nudge(deltaX: number, deltaY: number) {
    const current = cropBoxFor(size.width, size.height, draft);
    setDraft(
      focusFromCropBox(size.width, size.height, {
        left: Math.min(Math.max(current.left + deltaX, 0), 1 - current.width),
        top: Math.min(Math.max(current.top + deltaY, 0), 1 - current.height),
      }),
    );
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-dialog-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="flex max-h-[94vh] max-h-[94dvh] w-full max-w-[560px] flex-col overflow-y-auto rounded-t-2xl border border-line bg-panel p-4 shadow-[0_32px_90px_rgba(0,0,0,0.7)] sm:rounded-2xl sm:p-5">
        <h2 id="crop-dialog-title" className="text-[15px] font-semibold text-ink">
          Frame your banner
        </h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
          Drag the 16:9 frame over the part of {fileName || "your image"} you want in the ad slot.
        </p>

        <div className="mt-4 flex justify-center">
          {/* The stage is exactly the picture, so window maths is in picture
              coordinates no matter how the browser scaled it. */}
          {/* overflow-hidden keeps the window's huge dimming shadow inside the
              picture, so it can never paint over the dialog's own buttons. */}
          <div
            ref={stageRef}
            className="relative inline-block max-w-full select-none overflow-hidden rounded-lg"
          >
            <img
              src={src}
              alt=""
              onLoad={onImageLoad}
              draggable={false}
              className="block max-h-[52vh] max-h-[52dvh] w-auto max-w-full opacity-90"
            />
            <div
              ref={windowRef}
              role="group"
              aria-label="16:9 crop window. Use the arrow keys to move it."
              tabIndex={0}
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 0.1 : 0.02;
                if (event.key === "ArrowLeft") nudge(-step, 0);
                else if (event.key === "ArrowRight") nudge(step, 0);
                else if (event.key === "ArrowUp") nudge(0, -step);
                else if (event.key === "ArrowDown") nudge(0, step);
                else return;
                event.preventDefault();
              }}
              className="absolute cursor-move touch-none rounded-[3px] border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline-none focus-visible:border-white"
              style={{
                left: `${box.left * 100}%`,
                top: `${box.top * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
            >
              {/* Rule-of-thirds guides, dimmed so they never fight the picture. */}
              <span aria-hidden className="pointer-events-none absolute inset-0">
                <span className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
                <span className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
                <span className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
                <span className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">
            In the ad slot
          </p>
          <div className="mt-1.5 aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
            <img
              src={src}
              alt=""
              draggable={false}
              className="h-full w-full"
              style={creativeImageStyle(draft)}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 items-center justify-center rounded-md border border-line px-4 text-[12.5px] font-medium text-ink-2 transition hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(normalizeCreativeFocus(draft))}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-[12.5px] font-semibold text-white transition hover:bg-accent-soft"
          >
            <Check aria-hidden className="h-3.5 w-3.5" /> Use this frame
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The uploaded banner, framed exactly as the ad slot will show it.
 *
 * Tapping the picture reopens the crop picker; the delete button lives in the
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
