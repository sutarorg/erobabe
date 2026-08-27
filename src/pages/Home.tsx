/**
 * Home page: cinematic hero + trendings, popular, new, categories,
 * most-watched ranked list and editor's picks.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Eye, Flame, Play } from "lucide-react";
import { FALLBACK_THUMB, formatDuration, formatViews } from "../data/videos";
import { countByCategory, ensureDemoSeed, getCategories, getHomeFeed, getSettings, type HomeFeed } from "../lib/api";
import { useDocumentTitle } from "../lib/store";
import { CategoryCard, RankedList, VideoCard, VideoCarousel, VideoGrid } from "../components/video";
import { Button, GridSkeleton, SectionHeader } from "../components/ui";
import { cn } from "../utils/cn";

export default function HomePage() {
  useDocumentTitle("");
  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const settings = getSettings();

  useEffect(() => {
    ensureDemoSeed();
    let live = true;
    getHomeFeed().then((f) => live && setFeed(f));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="space-y-10 sm:space-y-14">
      {settings.sections.featured && (feed?.featured ? <Hero video={feed.featured} /> : <HeroSkeleton />)}

      {!feed ? (
        <GridSkeleton count={10} />
      ) : (
        <>
          {settings.sections.trending && (
            <VideoCarousel title="Trending Now" subtitle="What everyone's watching tonight" videos={feed.trending} viewAll="/trending" />
          )}

          {settings.sections.popular && (
            <section className="anim-fade-up">
              <SectionHeader
                title="Popular Videos"
                subtitle="All-time community favorites"
                action={
                  <Link to="/popular" className="ring-focus rounded-full px-2 text-xs font-semibold text-eb-rose-soft hover:text-eb-rose">
                    View all
                  </Link>
                }
              />
              <VideoGrid videos={feed.popular.slice(0, 10)} />
            </section>
          )}

          {settings.sections.newest && (
            <VideoCarousel title="New Releases" subtitle="Fresh uploads, straight from the studio" videos={feed.newest} viewAll="/new" />
          )}

          {settings.sections.categories && (
            <section className="anim-fade-up">
              <SectionHeader
                title="Explore Categories"
                action={
                  <Link to="/categories" className="ring-focus rounded-full px-2 text-xs font-semibold text-eb-rose-soft hover:text-eb-rose">
                    All categories
                  </Link>
                }
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {getCategories().filter((c) => !c.virtual).slice(0, 5).map((c) => (
                  <CategoryCard key={c.slug} category={c} count={countByCategory(c.slug)} />
                ))}
              </div>
            </section>
          )}

          {settings.sections.mostWatched && (
            <section className="anim-fade-up">
              <SectionHeader title="Most Watched" subtitle="The all-time top 10" />
              <RankedList videos={feed.mostWatched} />
            </section>
          )}

          <EditorPicks feed={feed} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Hero({ video }: { video: NonNullable<HomeFeed["featured"]> }) {
  return (
    <section className="anim-fade-up relative overflow-hidden rounded-3xl border border-eb-line">
      <div className="relative h-[300px] sm:h-[420px] lg:h-[500px]">
        <img
          src={video.thumbnail}
          alt={video.title}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)}
          className="anim-ken-burns absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-eb-950 via-eb-950/45 to-eb-950/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-eb-950/80 via-transparent to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-9">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-eb-rose to-eb-violet px-3 py-1 text-[10px] font-bold tracking-widest text-white uppercase shadow-lg shadow-eb-rose/30">
              <Flame size={11} /> Featured
            </span>
            <span className="rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[10px] font-semibold tracking-wide text-white/85 backdrop-blur-md">
              {video.quality} • {formatDuration(video.durationSec)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[10px] font-semibold text-white/85 backdrop-blur-md">
              <Eye size={11} /> {formatViews(video.views)}
            </span>
          </div>
          <h1 className="font-display max-w-2xl text-3xl leading-[1.05] font-bold tracking-tight text-white drop-shadow-lg sm:text-5xl lg:text-6xl">
            {video.title}
          </h1>
          <p className="mt-3 hidden max-w-xl text-sm leading-relaxed text-white/70 sm:block">{video.description}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6">
            <Link to={`/watch/${video.id}`}>
              <Button size="lg" className="gap-2.5">
                <Play size={17} className="fill-white" /> Watch Now
              </Button>
            </Link>
            <Link to="/explore">
              <Button size="lg" variant="glass" className="gap-2.5">
                Explore <ArrowUpRight size={16} />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroSkeleton() {
  return <div className="skeleton h-[300px] rounded-3xl sm:h-[420px] lg:h-[500px]" />;
}

function EditorPicks({ feed }: { feed: HomeFeed }) {
  if (!feed.editors.length) return null;
  return (
    <section className="anim-fade-up rounded-3xl border border-eb-line bg-gradient-to-br from-eb-900 to-eb-850 p-5 sm:p-7">
      <SectionHeader title="Editor's Picks" subtitle="Hand-selected by the EroBabe team" />
      <div className={cn("grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4")}>
        {feed.editors.slice(0, 4).map((v) => (
          <VideoCard key={v.id} video={v} />
        ))}
      </div>
    </section>
  );
}
