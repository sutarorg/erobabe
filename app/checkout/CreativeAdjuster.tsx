"use client";

import { useRef } from "react";
import { Move, RotateCcw, X, ZoomIn } from "lucide-react";
import {
  MAX_CREATIVE_ZOOM,
  DEFAULT_CREATIVE_FOCUS,
  creativeImageStyle,
  isDefaultCreativeFocus,
  normalizeCreativeFocus,
  type CreativeFocus,
} from "@/lib/ads/focus";

/**
 * The 16:9 placement, previewed with the advertiser's own picture in it.
 *
 * Banners arrive in every shape — a square logo, a tall poster, a wide strip,
 * an animated GIF — so the frame is fixed and the picture moves inside it:
 * drag to choose which part shows, slide to zoom into a detail. This is the
 * same `creativeImageStyle` the live placement uses, so the crop approved here
 * is the crop a visitor sees.
 */
export default function CreativeAdjuster({
  src,
  fileName,
  dimensions,
  focus,
  onFocusChange,
  onRemove,
}: {
  src: string;
  fileName: string;
  dimensions: string;
  focus: CreativeFocus;
  onFocusChange: (next: CreativeFocus) => void;
  onRemove: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; focus: CreativeFocus } | null>(null);
  const adjusted = !isDefaultCreativeFocus(focus);

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      focus: normalizeCreativeFocus(focus),
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom and older browsers: dragging still tracks the pointer */
    }
    event.currentTarget.style.cursor = "grabbing";
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    const frame = frameRef.current;
    if (!start || !frame) return;
    const width = frame.clientWidth || 1;
    const height = frame.clientHeight || 1;
    // A drag of one full frame width sweeps the whole focal range, so the
    // gesture feels the same on a phone and on a wide desktop panel.
    const deltaX = ((event.clientX - start.startX) / width) * 100;
    const deltaY = ((event.clientY - start.startY) / height) * 100;
    onFocusChange(
      normalizeCreativeFocus({
        // Dragging right reveals the left of the picture, which lowers the
        // CSS object-position percentage.
        x: start.focus.x - deltaX / start.focus.zoom,
        y: start.focus.y - deltaY / start.focus.zoom,
        zoom: start.focus.zoom,
      }),
    );
  }

  function endDrag() {
    drag.current = null;
    if (frameRef.current) frameRef.current.style.cursor = "grab";
  }

  return (
    <div className="mt-2">
      <div
        ref={frameRef}
        className="relative aspect-video w-full cursor-grab touch-none select-none overflow-hidden rounded-xl border border-accent/40 bg-black"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        role="img"
        aria-label={`16:9 preview of ${fileName}. Drag to reposition, zoom with the slider.`}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full"
          style={creativeImageStyle(focus)}
        />

        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2.5 pt-8 text-[10.5px]">
          <span className="max-w-[62%] truncate">{fileName}</span>
          <span className="shrink-0 text-emerald-300">{dimensions || "Any shape"}</span>
        </span>

        {adjusted && (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onFocusChange(DEFAULT_CREATIVE_FOCUS);
            }}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white backdrop-blur transition hover:bg-black/85"
          >
            <RotateCcw aria-hidden className="h-3 w-3" /> Reset
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-3">
          <Move aria-hidden className="h-3 w-3" /> Drag to position
        </span>
        <label className="flex flex-1 items-center gap-2">
          <ZoomIn aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          <span className="sr-only">Zoom the banner inside the 16:9 placement</span>
          <input
            type="range"
            min={1}
            max={MAX_CREATIVE_ZOOM}
            step={0.05}
            value={focus.zoom}
            onChange={(event) =>
              onFocusChange(
                normalizeCreativeFocus({ ...focus, zoom: Number(event.target.value) }),
              )
            }
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent"
          />
          <span className="w-9 shrink-0 text-right text-[10.5px] tabular-nums text-ink-3">
            {focus.zoom.toFixed(2)}×
          </span>
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-ink-3 transition hover:text-ink"
        >
          <X aria-hidden className="h-3 w-3" /> Remove
        </button>
      </div>
    </div>
  );
}
