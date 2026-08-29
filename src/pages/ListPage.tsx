import { VideoGrid } from "@/components/Sections";
import { popularVideos, newVideos } from "@/data/videos";
import { breadcrumbSchema, collectionSchema, schemaGraph, siteOrigin, useSEO, withOverride } from "@/lib/seo";
import { Clock, TrendingUp, type LucideIcon } from "lucide-react";

const CONFIG = {
  popular: {
    title: "Popular",
    blurb: "The videos viewers keep coming back to — ranked by all-time views.",
    icon: TrendingUp,
    videos: () => popularVideos.slice(0, 20),
  },
  new: {
    title: "New Releases",
    blurb: "Fresh uploads from the last few days, newest first.",
    icon: Clock,
    videos: () => newVideos.slice(0, 20),
  },
} satisfies Record<string, { title: string; blurb: string; icon: LucideIcon; videos: () => typeof popularVideos }>;

export default function ListPage({ kind }: { kind: keyof typeof CONFIG }) {
  const cfg = CONFIG[kind];
  const Icon = cfg.icon;
  const origin = siteOrigin();
  const popular = kind === "popular";
  const videos = cfg.videos();

  const pagePath = popular ? "/popular" : "/new";

  useSEO(withOverride(pagePath, {
    title: popular
      ? "Most Popular Adult Videos — All-Time Favorite 18+ Clips | EroBabe"
      : "New Adult Videos — Latest 18+ Releases in HD | EroBabe",
    description: popular
      ? "The most-watched adult videos on EroBabe, ranked by all-time views — the 18+ clips viewers keep coming back to."
      : "Fresh 18+ adult video releases on EroBabe — the newest HD uploads added in the last few days, updated constantly.",
    keywords: popular
      ? ["popular adult videos", "most watched 18+", "all-time favorites", "EroBabe popular"]
      : ["new adult videos", "latest 18+ releases", "fresh porn uploads", "EroBabe new"],
    canonical: `${origin}${pagePath}`,
    schema: schemaGraph(
      origin,
      collectionSchema(
        origin,
        pagePath,
        popular ? "Popular Adult Videos — EroBabe" : "New Adult Video Releases — EroBabe",
        popular
          ? "The most-watched adult videos on EroBabe."
          : "The latest adult video releases on EroBabe.",
        videos.slice(0, 12).map((v) => ({ name: v.title, url: `${origin}/video/${v.id}` }))
      ),
      breadcrumbSchema(siteOrigin(), [
        { name: "Home", path: "/" },
        { name: popular ? "Popular" : "New Releases", path: pagePath },
      ])
    ),
  }));

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-6 animate-fade-up md:mb-8">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white md:text-3xl">
          <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/25 to-violet-600/25 ring-1 ring-brand-500/30">
            <Icon className="size-5 text-brand-300" aria-hidden />
          </span>
          {cfg.title}
        </h1>
        <p className="mt-2 text-sm text-fog-500">
          {videos.length} videos · {cfg.blurb}
        </p>
      </header>
      <VideoGrid videos={videos} showAll />
    </div>
  );
}
