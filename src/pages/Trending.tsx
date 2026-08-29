import { Link } from "react-router-dom";
import { Clock, Eye, Flame, Play, TrendingUp } from "lucide-react";
import { trendingVideos, risingVideos, BROWSE_CATEGORIES, categoryCount, type Video } from "@/data/videos";
import { CategoryCard, RankList, SectionHeader, VideoGrid } from "@/components/Sections";
import { breadcrumbSchema, collectionSchema, schemaGraph, siteOrigin, useSEO, withOverride } from "@/lib/seo";
import { cn } from "@/lib/format";

function RankCard({ video, rank, size = "md" }: { video: Video; rank: number; size?: "lg" | "md" }) {
  return (
    <Link
      to={`/video/${video.id}`}
      className={cn(
        "group relative block overflow-hidden rounded-2xl ring-1 ring-white/10 transition duration-300 hover:ring-white/25 md:rounded-3xl",
        size === "lg" ? "aspect-[16/10] sm:aspect-[21/10]" : "aspect-video"
      )}
      aria-label={`Number ${rank} trending — ${video.title}`}
    >
      <img
        src={video.thumbnail}
        alt=""
        aria-hidden
        loading={rank === 1 ? "eager" : "lazy"}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/10" aria-hidden />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -bottom-8 right-2 select-none font-bold leading-none text-gradient opacity-90 transition duration-500 group-hover:opacity-100",
          size === "lg" ? "text-[11rem] md:text-[15rem]" : "text-[8rem]"
        )}
      >
        {String(rank).padStart(2, "0")}
      </span>
      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 md:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white md:text-[11px]">
          <Flame className="size-3" aria-hidden />#{rank} Trending
        </span>
        <h3 className={cn("mt-2.5 font-bold tracking-tight text-white line-clamp-1", size === "lg" ? "text-xl sm:text-2xl md:text-4xl" : "text-base sm:text-lg")}>
          {video.title}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] font-medium text-white/70 md:text-xs">
          <span className="inline-flex items-center gap-1"><Eye className="size-3.5" aria-hidden />{video.viewsLabel} views</span>
          <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />{video.durationLabel}</span>
          <span>{video.dateLabel}</span>
        </div>
        {size === "lg" && (
          <span className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-white/12 px-5 text-sm font-semibold text-white backdrop-blur transition group-hover:bg-gradient-to-r group-hover:from-brand-500 group-hover:to-violet-600">
            <Play className="size-4 fill-white" aria-hidden />
            Watch now
          </span>
        )}
      </div>
    </Link>
  );
}

export default function Trending() {
  useSEO(withOverride("/trending", {
    title: "Trending Adult Videos — Today's Hottest 18+ Clips | EroBabe",
    description:
      "See what's trending on EroBabe right now — the #1 hottest 18+ videos, the weekly leaderboard and the fastest-rising clips, updated daily.",
    keywords: ["trending adult videos", "hot 18+ clips", "most watched", "EroBabe trending"],
    canonical: `${siteOrigin()}/trending`,
    schema: schemaGraph(
      siteOrigin(),
      collectionSchema(
        siteOrigin(),
        "/trending",
        "Trending Adult Videos — EroBabe",
        "The most-watched adult videos on EroBabe this week.",
        trendingVideos.slice(0, 8).map((v) => ({ name: v.title, url: `${siteOrigin()}/video/${v.id}` }))
      ),
      breadcrumbSchema(siteOrigin(), [
        { name: "Home", path: "/" },
        { name: "Trending", path: "/trending" },
      ])
    ),
  }));
  const list = trendingVideos;
  const top = list.slice(0, 3);

  return (
    <div className="mx-auto max-w-[1600px] space-y-10 px-4 pt-4 md:space-y-14 md:px-8 md:pt-6">
      <header className="animate-fade-up">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white md:text-3xl">
          <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 shadow-[0_8px_30px_-6px_rgba(244,63,127,0.6)]">
            <Flame className="size-5 text-white" aria-hidden />
          </span>
          Trending
        </h1>
        <p className="mt-2 text-sm text-fog-500">The most-watched videos on EroBabe this week — refreshed nightly.</p>
      </header>

      {/* Top 3 */}
      <section aria-label="Top trending" className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="animate-fade-up">{top[0] && <RankCard video={top[0]} rank={1} size="lg" />}</div>
        <div className="grid content-start gap-4">
          {top.slice(1).map((v, i) => (
            <div key={v.id} className="animate-fade-up" style={{ animationDelay: `${(i + 1) * 90}ms` }}>
              <RankCard video={v} rank={i + 2} />
            </div>
          ))}
        </div>
      </section>

      {/* Leaderboard */}
      <section aria-label="Trending leaderboard">
        <SectionHeader eyebrow="This week's chart" title="Trending Leaderboard" icon={TrendingUp} />
        <div className="rounded-3xl border border-white/6 bg-ink-900/40 px-4 py-2 sm:px-6">
          <RankList videos={list.slice(0, 10)} />
        </div>
      </section>

      {/* Rising */}
      {risingVideos.length > 0 && (
        <section aria-label="Rising videos">
          <SectionHeader eyebrow="Fastest growing right now" title="Rising Now" />
          <VideoGrid videos={risingVideos} />
        </section>
      )}

      {/* Popular categories */}
      <section aria-label="Popular categories">
        <SectionHeader eyebrow="Keep exploring" title="Popular Categories" href="/categories" />
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:gap-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
          {BROWSE_CATEGORIES.slice(0, 3).map((c) => (
            <CategoryCard key={c.slug} category={c} count={categoryCount(c.slug)} className="w-[240px] shrink-0 snap-start md:w-auto" />
          ))}
        </div>
      </section>
    </div>
  );
}
