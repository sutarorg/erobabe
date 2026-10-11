"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";
import PublicVideoCard from "@/src/components/PublicVideoCard";
import type { PublicCategory, PublicVideo } from "@/lib/public/catalog";
import { cn } from "@/src/utils/cn";

export default function BrowserClient({
  videos,
  categories,
}: {
  videos: PublicVideo[];
  categories: PublicCategory[];
}) {
  const [active, setActive] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!active) return videos;
    return videos.filter((video) => video.category_slug === active);
  }, [videos, active]);

  return (
    <div className="pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">Browse</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">All videos</h1>
        <span className="text-[12px] tabular-nums text-ink-3">
          {filtered.length} {filtered.length === 1 ? "video" : "videos"}
        </span>
      </div>

      {categories.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          <button
            type="button"
            onClick={() => setActive(null)}
            aria-pressed={active === null}
            className={cn(
              "flex h-7 items-center rounded-full border px-3 text-[11.5px] font-medium transition-colors",
              active === null
                ? "border-accent/60 bg-accent/12 text-accent"
                : "border-line bg-card text-ink-2 hover:border-zinc-600 hover:text-ink"
            )}
          >
            All
          </button>
          {categories.map((category) => {
            const selected = active === category.slug;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setActive(selected ? null : category.slug)}
                aria-pressed={selected}
                className={cn(
                  "flex h-7 items-center rounded-full border px-3 text-[11.5px] font-medium transition-colors",
                  selected
                    ? "border-accent/60 bg-accent/12 text-accent"
                    : "border-line bg-card text-ink-2 hover:border-zinc-600 hover:text-ink"
                )}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((video) => (
            <PublicVideoCard key={video.slug} video={video} />
          ))}
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed border-line bg-card py-16 text-center">
          <SearchX className="h-8 w-8 text-ink-3" aria-hidden />
          <p className="mt-3 text-[14px] font-medium">No videos found</p>
          <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-ink-3">
            {videos.length === 0
              ? "The library is being prepared. Check back soon for premium content."
              : "Try a different category or browse everything."}
          </p>
          {active ? (
            <button
              type="button"
              onClick={() => setActive(null)}
              className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft"
            >
              Clear filter
            </button>
          ) : (
            <Link
              href="/"
              prefetch
              className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft"
            >
              Back to home
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
