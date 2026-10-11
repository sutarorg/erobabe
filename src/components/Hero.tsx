"use client";
import { ChevronLeft, ChevronRight, LayoutGrid, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { HERO_SLIDES } from "../data/content";
import { cn } from "../utils/cn";

/**
 * Callbacks are optional so the hero can be rendered from Server Components.
 * When no handler is supplied we fall back to client-side navigation, which
 * keeps the buttons functional without passing functions across the
 * server/client boundary.
 */
interface HeroProps {
  onExplore?: () => void;
  onBrowseCategories?: () => void;
}

export default function Hero({ onExplore, onBrowseCategories }: HeroProps = {}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = HERO_SLIDES.length;

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

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => go(index + 1), 6500);
    return () => window.clearInterval(id);
  }, [index, paused, go]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured highlights"
      className="relative mt-4 h-[238px] select-none overflow-hidden rounded-[10px] border border-line bg-panel @sm:h-[256px] @2xl:h-[272px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {HERO_SLIDES.map((slide, i) => {
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
            <img
              src={slide.image}
              alt={slide.alt}
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover object-[70%_center]"
            />
            {/* Readability overlays: keep the left text zone dark */}
            <div className="absolute inset-0 bg-gradient-to-r from-panel via-panel/85 to-panel/5" />
            <div className="absolute inset-0 bg-gradient-to-t from-panel/70 via-transparent to-panel/20" />

            <div className="absolute inset-0 flex items-center">
              <div className="max-w-[78%] px-5 @sm:max-w-[64%] @2xl:max-w-[60%] @2xl:px-7">
                <span className="inline-flex items-center rounded-full border border-accent/55 bg-accent/12 px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.18em] text-accent backdrop-blur-sm">
                  {slide.eyebrow}
                </span>
                <h1 className="mt-3 whitespace-pre-line text-[21px] font-semibold leading-[1.14] tracking-tight text-white @sm:text-[24px] @2xl:text-[27px]">
                  {slide.headline}
                </h1>
                <p className="mt-2.5 max-w-[350px] text-[12px] leading-relaxed text-ink-2 @2xl:text-[13px]">
                  {slide.sub}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleExplore}
                    tabIndex={active ? 0 : -1}
                    className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_4px_18px_rgba(245,22,85,0.28)] transition-colors hover:bg-accent-soft"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                    Explore Videos
                  </button>
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
        {HERO_SLIDES.map((slide, i) => (
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

      {/* Carousel controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
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
