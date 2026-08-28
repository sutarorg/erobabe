import { useMemo, useState } from "react";
import { CalendarDays, Clock, Compass, Eye, Flame, LayoutGrid, TrendingUp } from "lucide-react";
import { CATEGORIES, VIDEOS, trendingVideos, risingVideos, newVideos, editorsPicks, categoryCount } from "@/data/videos";
import { CategoryCard, FilterChips, RankList, SectionHeader, VideoGrid, type ChipOption } from "@/components/Sections";
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
      // Popular blends quality and reach; Most Viewed is raw lifetime views,
      // so the two chips return genuinely different line-ups.
      case "popular": return [...VIDEOS].sort((a, b) => b.score - a.score);
      case "mostviewed": return [...VIDEOS].sort((a, b) => b.views - a.views);
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
        <SectionHeader eyebrow="All categories" title="Browse Categories" href="/categories" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {CATEGORIES.map((c) => (
            <CategoryCard key={c.slug} category={c} count={c.href ? undefined : categoryCount(c.slug)} />
          ))}
        </div>
      </section>

      <section aria-label="Filtered videos">
        <FilterChips ariaLabel="Explore filters" options={CHIPS} value={filter} onChange={setFilter} className="sticky top-14 z-20 -mt-2 py-3 md:top-16 glass -mx-4 px-4 border-y border-white/5 md:rounded-full md:border md:mx-0 md:mt-0 md:w-fit" />
        <p className="mb-4 mt-1 text-xs font-medium text-fog-600 md:mt-3">
          {videos.length} videos · {CHIPS.find((c) => c.key === filter)?.label}
        </p>
        <VideoGrid videos={videos} showAll />
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-label="Editor's picks">
          <SectionHeader eyebrow="Staff selections" title="Editor's Picks" />
          <div className="rounded-3xl border border-white/6 bg-ink-900/40 px-4 py-2 sm:px-6">
            {editorsPicks.length > 0 ? (
              <RankList videos={editorsPicks.slice(0, 5)} />
            ) : (
              <p className="px-1 py-10 text-center text-sm text-fog-600">
                No editor's picks yet — mark videos as “Editor's pick” in the admin to feature them here.
              </p>
            )}
          </div>
        </section>
        <section aria-label="Rising now">
          <SectionHeader eyebrow="Gaining momentum" title="Rising Now" href="/trending" />
          {risingVideos.length > 0 ? (
            <VideoGrid videos={risingVideos} />
          ) : (
            <p className="rounded-3xl border border-white/6 bg-ink-900/40 px-4 py-10 text-center text-sm text-fog-600">
              Rising videos appear here as new content gains momentum.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
