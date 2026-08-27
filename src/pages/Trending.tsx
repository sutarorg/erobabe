/**
 * Trending page: podium top-3, rising videos, the full trending grid
 * and hot categories.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Rocket } from "lucide-react";
import { formatViews, trendingScore, type Video } from "../data/videos";
import { countByCategory, getCategories, listVideos } from "../lib/api";
import { useDocumentTitle } from "../lib/store";
import { CategoryCard, Thumb, VideoGrid } from "../components/video";
import { GridSkeleton, SectionHeader } from "../components/ui";
import { cn } from "../utils/cn";

export default function TrendingPage() {
  useDocumentTitle("Trending");
  const [trending, setTrending] = useState<Video[] | null>(null);

  useEffect(() => {
    let live = true;
    listVideos({ sort: "trending", limit: 24 }).then((v) => live && setTrending(v));
    return () => {
      live = false;
    };
  }, []);

  const rising = useMemo(
    () => (trending ?? []).filter((v) => v.daysAgo <= 7).sort((a, b) => trendingScore(b) - trendingScore(a)).slice(0, 5),
    [trending]
  );
  const hotCategories = useMemo(() => {
    if (!trending) return [];
    const counts = new Map<string, number>();
    trending.forEach((v) => counts.set(v.category, (counts.get(v.category) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([slug]) => getCategories().find((c) => c.slug === slug)!).filter(Boolean);
  }, [trending]);

  if (!trending)
    return (
      <div>
        <TrendingHeader />
        <GridSkeleton count={10} />
      </div>
    );

  const podium = trending.slice(0, 3);
  const rest = trending.slice(3);

  return (
    <div className="anim-fade-up space-y-12">
      <TrendingHeader />

      {/* Podium */}
      <section aria-label="Top trending">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {podium.map((v, i) => (
            <Link key={v.id} to={`/watch/${v.id}`} className="group ring-focus relative block rounded-2xl" aria-label={`#${i + 1} trending: ${v.title}`}>
              <div className="relative">
                <span
                  className={cn(
                    "font-display pointer-events-none absolute -top-7 -left-1 z-10 text-[84px] leading-none font-bold tracking-tighter transition-all duration-300 sm:text-[104px]",
                    "outline-num-accent group-hover:-translate-y-1"
                  )}
                >
                  {i + 1}
                </span>
                <Thumb video={v} className="ml-12 border border-eb-line transition-shadow duration-300 group-hover:shadow-2xl group-hover:shadow-eb-rose/15 sm:ml-16" />
              </div>
              <div className="mt-2.5 ml-12 sm:ml-16">
                <h2 className="line-clamp-1 text-sm font-semibold text-eb-text group-hover:text-white">{v.title}</h2>
                <p className="mt-0.5 text-xs text-eb-faint">{formatViews(v.views)} views</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Rising */}
      <section>
        <SectionHeader title="Rising Fast" subtitle="Gaining the most momentum this week" />
        <ol className="grid gap-2">
          {rising.map((v, i) => (
            <li key={v.id}>
              <Link to={`/watch/${v.id}`} className="group ring-focus flex items-center gap-4 rounded-2xl border border-eb-line bg-eb-900/50 p-2.5 transition hover:border-eb-rose/30 hover:bg-eb-900">
                <span className="font-display w-9 shrink-0 text-center text-2xl font-bold outline-num group-hover:outline-num-accent">{String(i + 1).padStart(2, "0")}</span>
                <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-eb-800 sm:w-32">
                  <img src={v.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-1 text-sm font-semibold text-eb-text group-hover:text-white">{v.title}</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-eb-faint">
                    <Rocket size={11} className="text-eb-rose-soft" /> {formatViews(v.views)} views • rising
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* Grid */}
      <section>
        <SectionHeader title="Trending Grid" subtitle="Positions #4 and beyond" />
        <VideoGrid videos={rest} />
      </section>

      {/* Hot categories */}
      <section>
        <SectionHeader title="Hot Categories" subtitle="Where the momentum is right now" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {hotCategories.map((c) => (
            <CategoryCard key={c.slug} category={c} count={countByCategory(c.slug)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function TrendingHeader() {
  return (
    <header className="flex items-center gap-4">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-eb-rose to-eb-violet text-white shadow-lg shadow-eb-rose/30">
        <Flame size={22} />
      </span>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">Trending</h1>
        <p className="mt-0.5 text-sm text-eb-muted">Ranked by recency-weighted views, updated continuously.</p>
      </div>
    </header>
  );
}
