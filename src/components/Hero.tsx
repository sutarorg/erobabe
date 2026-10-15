"use client";
import { ChevronLeft, ChevronRight, LayoutGrid, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { HERO_SLIDES, type HeroSlide } from "../data/content";
import { cn } from "../utils/cn";
import ThumbImage from "./ThumbImage";

/**
 * Callbacks are optional so the hero can be rendered from Server Components.
 * When no handler is supplied we fall back to client-side navigation, which
 * keeps the buttons functional without passing functions across the
 * server/client boundary.
 */
interface HeroProps {
  onExplore?: () => void;
  onBrowseCategories?: () => void;
  /**
   * Admin-chosen video slides (from /admin/videos). When empty, the default
   * promotional slides are shown so the homepage never renders a blank card.
   */
  slides?: HeroSlide[];
}

const SWIPE_THRESHOLD_PX = 40;

export default function Hero({ onExplore, onBrowseCategories, slides }: HeroProps = {}) {
  const router = useRouter();
  const HERO_ITEMS: HeroSlide[] = slides && slides.length ? slides : HERO_SLIDES;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const swipeStartX = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);
  const total = HERO_ITEMS.length;

  const handleExplore = useCallback(() => {
    if (onExplore) onExplore();
    else router.push("/latest");
  }, [onExplore, router]);

  const handleBrowseCategories = useCallback(() => {
    if (onBrowseCategories) onBrowseCategories();
    else router.push("/categories");
  }, [onBrowseCategories, router]);

  const go = useCallback(
    (next: number) => setIndex(((next % total) + total) % total),
    [total]
  );

  const handleSwipeStart = useCallback((clientX: number, clientY: number) => {
    swipeStartX.current = clientX;
    swipeStartY.current = clientY;
  }, []);

  const handleSwipeEnd = useCallback(
    (clientX: number, clientY: number) => {
      if (swipeStartX.current === null || swipeStartY.current === null) return;
      const deltaX = clientX - swipeStartX.current;
      const deltaY = clientY - swipeStartY.current;
      swipeStartX.current = null;
      swipeStartY.current = null;
      if (
        Math.abs(deltaX) >= SWIPE_THRESHOLD_PX &&
        Math.abs(deltaX) > Math.abs(deltaY)
      ) {
        if (deltaX < 0) {
          go(index + 1);
        } else {
          go(index - 1);
        }
      }
    },
    [go, index]
  );

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => go(index + 1), 6500);
    return () => window.clearInterval(id);
  }, [index, paused, go]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured highlights"
      className="relative mt-4 h-[320px] min-h-[320px] touch-pan-y select-none overflow-hidden rounded-[10px] border border-line bg-panel sm:h-[268px] sm:min-h-[268px] @sm:h-[268px] @2xl:h-[280px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => {
        setPaused(true);
        const touch = e.touches[0];
        if (touch) handleSwipeStart(touch.clientX, touch.clientY);
      }}
      onTouchEnd={(e) => {
        setPaused(false);
        const touch = e.changedTouches[0];
        if (touch) handleSwipeEnd(touch.clientX, touch.clientY);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") return;
        handleSwipeStart(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "touch") return;
        handleSwipeEnd(e.clientX, e.clientY);
      }}
    >
      {HERO_ITEMS.map((slide, i) => {
        const active = i === index;
        return (
          <div
            key={slide.id}
            aria-hidden={!active}
            className={cn(
              "absolute inset-0 transition-opacity duration-700 ease-out",
              active ? "opacity-100" : "pointer-events-none opacity-0"
            )}
          >
            <ThumbImage
              src={slide.image}
              alt={slide.alt}
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : "low"}
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover object-[70%_center]"
            />
            {/*
              Readability overlays. Kept deliberately light — the thumbnail is
              the point of the card — so the text zone fades rather than blocks:
              about 75% opacity behind the headline instead of a solid panel.
            */}
            <div className="absolute inset-0 bg-gradient-to-r from-panel/75 via-panel/40 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-panel/60 via-transparent to-panel/5" />

            <div className="absolute inset-0 flex items-center">
              <div className="w-full max-w-[92%] px-5 pt-4 pb-9 sm:max-w-[68%] sm:py-0 @sm:max-w-[64%] @2xl:max-w-[60%] @2xl:px-7">
                <span className="inline-flex items-center rounded-full border border-accent/55 bg-accent/12 px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.18em] text-accent backdrop-blur-sm">
                  {slide.eyebrow}
                </span>
                <h1 className="mt-2.5 whitespace-pre-line text-[20px] font-semibold leading-[1.16] tracking-tight text-white sm:mt-3 sm:text-[24px] @sm:text-[24px] @2xl:text-[27px]">
                  {slide.headline}
                </h1>
                <p className="mt-2 max-w-[350px] text-[12px] leading-relaxed text-ink-2 sm:mt-2.5 @2xl:text-[13px]">
                  {slide.sub}
                </p>
                <div className="mt-3.5 flex flex-wrap items-center gap-2.5 sm:mt-4">
                  {slide.href ? (
                    <Link
                      href={slide.href}
                      tabIndex={active ? 0 : -1}
                      className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_4px_18px_rgba(245,22,85,0.28)] transition-colors hover:bg-accent-soft"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                      Watch now
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={handleExplore}
                      tabIndex={active ? 0 : -1}
                      className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_4px_18px_rgba(245,22,85,0.28)] transition-colors hover:bg-accent-soft"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                      Explore Videos
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleBrowseCategories}
                    tabIndex={active ? 0 : -1}
                    className="flex h-9 items-center gap-1.5 rounded-md border border-white/15 bg-black/25 px-4 text-[13px] font-medium text-zinc-200 backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-white/5"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                    Browse Categories
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Pagination dots */}
      <div className="absolute bottom-3.5 left-5 flex items-center gap-1.5 @2xl:left-7">
        {HERO_ITEMS.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => go(i)}
            aria-label={`Go to slide ${i + 1}`}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i === index ? "w-5 bg-accent" : "w-1.5 bg-white/25 hover:bg-white/50"
            )}
          />
        ))}
      </div>

      {/* Carousel controls — hidden on mobile; swipe left/right navigates on mobile */}
      <div className="absolute bottom-3 right-3 hidden items-center gap-1.5 sm:flex">
        <button
          type="button"
          onClick={() => go(index - 1)}
          aria-label="Previous slide"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/12 bg-black/45 text-zinc-300 backdrop-blur-sm transition-colors hover:border-accent/60 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          aria-label="Next slide"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/12 bg-black/45 text-zinc-300 backdrop-blur-sm transition-colors hover:border-accent/60 hover:text-white"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
