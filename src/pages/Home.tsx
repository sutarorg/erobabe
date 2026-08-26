import { Link } from "react-router-dom";
import { ArrowRight, Clock, Compass, Eye, Flame, Play, Sparkles, ThumbsUp, Trophy } from "lucide-react";
import {
  featuredVideo, HERO_IMAGE, BROWSE_CATEGORIES, editorsPicks, trendingVideos,
  popularVideos, newVideos, mostViewed, categoryCount, categoryName, type Video,
} from "@/data/videos";
import { Carousel, CategoryCard, RankList, SectionHeader, VideoGrid, Tag } from "@/components/Sections";
import { AgeBadge } from "@/components/Brand";
import { publicSettings } from "@/data/dynamic";
import { useDocumentTitle } from "@/hooks/store";

function Hero({ video }: { video: Video }) {
  return (
    <section
      aria-label="Featured video"
      className="relative overflow-hidden rounded-2xl ring-1 ring-white/10 animate-fade-up md:rounded-3xl"
    >
      <img
        src={HERO_IMAGE}
        alt=""
        aria-hidden
        fetchPriority="high"
        className="absolute inset-0 h-full w-full object-cover animate-zoom-slow"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/45 to-ink-950/10" aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-ink-950/25 to-transparent" aria-hidden />

      <div className="relative flex min-h-[380px] max-w-3xl flex-col justify-end p-5 sm:min-h-[440px] sm:p-8 md:min-h-[520px] md:p-12">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300">
          <Flame className="size-3.5" aria-hidden />
          <span>Featured tonight</span>
          <span className="text-fog-600">·</span>
          <span className="text-fog-400">{categoryName(video.category)}</span>
          <AgeBadge />
        </div>

        <h1 className="mt-3 text-3xl font-bold leading-[1.05] tracking-tight text-white sm:text-4xl md:text-[52px]">
          {video.title}
        </h1>

        <p className="mt-3 max-w-xl text-sm leading-relaxed text-fog-300 line-clamp-2 md:text-[15px]">
          {video.description}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-medium text-fog-400 md:text-[13px]">
          <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5 text-fog-500" aria-hidden />{video.durationLabel}</span>
          <span className="inline-flex items-center gap-1.5"><Eye className="size-3.5 text-fog-500" aria-hidden />{video.viewsLabel} views</span>
          <span className="inline-flex items-center gap-1.5"><ThumbsUp className="size-3.5 text-fog-500" aria-hidden />{video.likeRatio}% liked</span>
          <span className="text-fog-500">{video.dateLabel}</span>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to={`/watch/${video.id}`}
            className="group inline-flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-6 text-sm font-semibold text-white shadow-[0_12px_40px_-8px_rgba(244,63,127,0.6)] transition hover:brightness-110 active:scale-95"
          >
            <Play className="size-4.5 fill-white transition-transform group-hover:scale-110" aria-hidden />
            Watch Now
          </Link>
          <Link
            to="/explore"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-white/15 bg-white/8 px-6 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15 active:scale-95"
          >
            <Compass className="size-4.5" aria-hidden />
            Explore
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  useDocumentTitle("");
  return (
    <div className="mx-auto max-w-[1600px] space-y-10 px-4 pt-4 md:space-y-14 md:px-8 md:pt-6">
      {featuredVideo && publicSettings.heroEnabled && <Hero video={featuredVideo} />}

      <section aria-label="Trending now">
        <SectionHeader eyebrow="Hot right now" title="Trending Now" href="/trending" icon={Flame} />
        <Carousel videos={trendingVideos.slice(0, 10)} />
      </section>

      <section aria-label="Popular videos">
        <SectionHeader eyebrow="Viewer favorites" title="Popular Videos" href="/popular" icon={Trophy} />
        <VideoGrid videos={popularVideos.slice(0, 10)} />
      </section>

      <section aria-label="New releases">
        <SectionHeader eyebrow="Fresh uploads" title="New Releases" href="/new" icon={Sparkles} />
        <Carousel videos={newVideos.slice(0, 10)} />
      </section>

      <section aria-label="Browse categories">
        <SectionHeader eyebrow="Find your mood" title="Explore Categories" href="/categories" />
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:gap-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
          {BROWSE_CATEGORIES.map((c) => (
            <CategoryCard
              key={c.slug}
              category={c}
              count={categoryCount(c.slug)}
              className="w-[240px] shrink-0 snap-start md:w-auto"
            />
          ))}
        </div>
      </section>

      <section aria-label="Most watched">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div>
            <SectionHeader eyebrow="All time" title="Most Watched" href="/popular" />
            <div className="rounded-3xl border border-white/6 bg-ink-900/40 px-4 py-2 sm:px-6">
              <RankList videos={mostViewed.slice(0, 5)} />
            </div>
          </div>
          <div>
            <SectionHeader eyebrow="Staff selections" title="Editor's Picks" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {editorsPicks.slice(0, 2).map((v) => (
                <Link
                  key={v.id}
                  to={`/watch/${v.id}`}
                  className="group relative block aspect-video overflow-hidden rounded-2xl ring-1 ring-white/8 transition hover:ring-white/20"
                >
                  <img
                    src={v.thumbnail}
                    alt={`${v.title} thumbnail`}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" aria-hidden />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <Tag label="Editor's Pick" className="mb-2 border-brand-500/40 bg-brand-500/15 text-brand-200" />
                    <h3 className="line-clamp-1 text-sm font-semibold text-white">{v.title}</h3>
                    <p className="mt-0.5 text-xs text-white/60">{v.viewsLabel} views · {v.durationLabel}</p>
                  </div>
                </Link>
              ))}
            </div>
            <Link
              to="/explore"
              className="group mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-fog-400 transition hover:text-brand-300"
            >
              Browse Editor's Picks <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
