import { VideoGrid } from "@/components/Sections";
import { popularVideos, newVideos } from "@/data/videos";
import { useSEO } from "@/lib/seo";
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
  useSEO(
    kind === "popular"
      ? {
          title: "Popular 18+ Videos — EroBabe",
          description:
            "The most-watched adult videos on EroBabe — ranked by all-time views and the content viewers keep coming back to.",
        }
      : {
          title: "New 18+ Video Releases — EroBabe",
          description:
            "Fresh 18+ adult video releases on EroBabe — the latest uploads from the last few days, newest first.",
        }
  );
  const videos = cfg.videos();

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
      <VideoGrid videos={videos} />
    </div>
  );
}
