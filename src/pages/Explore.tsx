import { useMemo, useState } from "react";
import { CalendarDays, Clock, Compass, Eye, Flame, LayoutGrid, TrendingUp } from "lucide-react";
import { CATEGORIES, VIDEOS, trendingVideos, popularVideos, newVideos, editorsPicks, categoryCount } from "@/data/videos";
import { Carousel, CategoryCard, FilterChips, RankList, SectionHeader, VideoGrid, type ChipOption } from "@/components/Sections";
import { useSEO } from "@/lib/seo";

const CHIPS: ChipOption[] = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "trending", label: "Trending", icon: Flame },
  { key: "new", label: "New", icon: Clock },
  { key: "popular", label: "Popular", icon: TrendingUp },
  { key: "mostviewed", label: "Most Viewed", icon: Eye },
  { key: "recent", label: "Recently Added", icon: CalendarDays },
];

export default function Explore() {
  useSEO({
    title: "Explore 18+ Adult Videos — EroBabe",
    description:
      "Browse the full EroBabe catalog — filter trending videos, new releases, popular categories, most-viewed content and editor's picks in one place.",
  });
  const [filter, setFilter] = useState("all");

  const videos = useMemo(() => {
    switch (filter) {
      case "trending": return trendingVideos;
      case "new": return VIDEOS.filter((v) => v.isNew);
      case "popular": return popularVideos.slice(0, 20);
      case "mostviewed": return [...VIDEOS].sort((a, b) => b.views - a.views).slice(0, 20);
      case "recent": return newVideos.slice(0, 20);
      default: return [...VIDEOS].sort((a, b) => b.score - a.score).slice(0, 20);
    }
  }, [filter]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 px-4 pt-4 md:space-y-10 md:px-8 md:pt-6">
      <header className="animate-fade-up">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white md:text-3xl">
          <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/25 to-violet-600/25 ring-1 ring-brand-500/30">
            <Compass className="size-5 text-brand-300" aria-hidden />
          </span>
          Explore
        </h1>
        <p className="mt-2 max-w-lg text-sm text-fog-500">
          Dive into the full catalog — filter by momentum, freshness or all-time popularity.
        </p>
      </header>

      <section aria-label="Browse categories">
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:gap-4 md:mx-0 md:px-0">
          {CATEGORIES.map((c) => (
            <CategoryCard
              key={c.slug}
              category={c}
              count={c.href ? undefined : categoryCount(c.slug)}
              className="w-[210px] shrink-0 snap-start"
            />
          ))}
        </div>
      </section>

      <section aria-label="Filtered videos">
        <FilterChips ariaLabel="Explore filters" options={CHIPS} value={filter} onChange={setFilter} className="sticky top-14 z-20 -mt-2 py-3 md:top-16 glass -mx-4 px-4 border-y border-white/5 md:rounded-full md:border md:mx-0 md:mt-0 md:w-fit" />
        <p className="mb-4 mt-1 text-xs font-medium text-fog-600 md:mt-3">
          {videos.length} videos · {CHIPS.find((c) => c.key === filter)?.label}
        </p>
        <VideoGrid videos={videos} />
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-label="Editor's picks">
          <SectionHeader eyebrow="Staff selections" title="Editor's Picks" />
          <div className="rounded-3xl border border-white/6 bg-ink-900/40 px-4 py-2 sm:px-6">
            <RankList videos={editorsPicks.slice(0, 5)} />
          </div>
        </section>
        <section aria-label="Rising now">
          <SectionHeader eyebrow="Gaining momentum" title="Rising Now" href="/trending" />
          <Carousel videos={newVideos.filter((v) => v.score > 500_000).slice(0, 8)} />
        </section>
      </div>
    </div>
  );
}
