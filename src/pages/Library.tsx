import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Compass, Heart, Trash2 } from "lucide-react";
import { getVideoById, type Video } from "@/data/videos";
import { useLikes, useSaved } from "@/hooks/store";
import { EmptyState, VideoGrid } from "@/components/Sections";
import { toast } from "@/components/Feedback";
import { useSEO } from "@/lib/seo";
import { cn } from "@/lib/format";

type Tab = "liked" | "later";

/**
 * The viewer's personal library: everything they liked and everything
 * saved for later. Both lists live in localStorage, so they survive
 * refreshes and return visits without an account.
 */
export default function Library({ initial = "liked" }: { initial?: Tab }) {
  const likes = useLikes();
  const saved = useSaved();
  const [tab, setTab] = useState<Tab>(initial);

  useSEO({
    title: tab === "liked" ? "Liked Videos — EroBabe" : "Watch Later — EroBabe",
    robots: "noindex, follow",
  });

  // Newest additions first — the store appends, so reverse for recency.
  const resolve = (ids: string[]): Video[] =>
    [...ids].reverse().map((id) => getVideoById(id)).filter((v): v is Video => Boolean(v));

  const likedVideos = useMemo(() => resolve(likes.ids), [likes.ids]);
  const laterVideos = useMemo(() => resolve(saved.ids), [saved.ids]);

  const active = tab === "liked" ? likedVideos : laterVideos;
  const activeStore = tab === "liked" ? likes : saved;

  const TABS: { key: Tab; label: string; icon: typeof Heart; count: number }[] = [
    { key: "liked", label: "Liked", icon: Heart, count: likedVideos.length },
    { key: "later", label: "Watch Later", icon: Bookmark, count: laterVideos.length },
  ];

  const clearAll = () => {
    for (const v of active) activeStore.toggle(v.id);
    toast(tab === "liked" ? "Cleared liked videos" : "Cleared Watch Later");
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 animate-fade-up md:mb-7">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white md:text-3xl">
            <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/25 to-violet-600/25 ring-1 ring-brand-500/30">
              {tab === "liked" ? (
                <Heart className="size-5 text-brand-300" aria-hidden />
              ) : (
                <Bookmark className="size-5 text-brand-300" aria-hidden />
              )}
            </span>
            Your library
          </h1>
          <p className="mt-2 text-sm text-fog-500">
            Saved privately in this browser — no account needed.
          </p>
        </div>
        {active.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-ink-800 px-4 text-xs font-semibold text-fog-300 transition hover:border-red-500/50 hover:text-red-300 active:scale-95"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Clear {tab === "liked" ? "liked" : "list"}
          </button>
        )}
      </header>

      {/* Tabs */}
      <div role="tablist" aria-label="Library" className="mb-6 flex gap-1 rounded-xl border border-white/6 bg-ink-900/60 p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === key
                ? "bg-gradient-to-r from-brand-500 to-violet-600 text-white"
                : "text-fog-400 hover:text-white"
            )}
          >
            <Icon className={cn("size-4", tab === key && key === "liked" && "fill-white")} aria-hidden />
            {label}
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                tab === key ? "bg-white/20 text-white" : "bg-white/6 text-fog-500"
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon={tab === "liked" ? Heart : Bookmark}
          title={tab === "liked" ? "No liked videos yet" : "Nothing saved for later"}
          body={
            tab === "liked"
              ? "Tap the Like button on any video and it will appear here."
              : "Use Save on any video to build your Watch Later list."
          }
          action={
            <Link
              to="/explore"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-6 text-sm font-semibold text-white transition hover:brightness-110"
            >
              <Compass className="size-4" aria-hidden />
              Browse videos
            </Link>
          }
        />
      ) : (
        <VideoGrid videos={active} showAll />
      )}
    </div>
  );
}
