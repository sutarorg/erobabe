import { useState } from "react";
import { Link } from "react-router-dom";
import { Compass, History as HistoryIcon, Trash2, X } from "lucide-react";
import { getVideoById, categoryName } from "@/data/videos";
import { useHistory } from "@/hooks/store";
import { useSEO } from "@/lib/seo";
import { EmptyState } from "@/components/Sections";
import { cn, timeAgo } from "@/lib/format";

function watchedAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`;
  return timeAgo(Math.floor(h / 24));
}

export default function History() {
  useSEO({ title: "Watch History — EroBabe", robots: "noindex, follow" });
  const { list, remove, clear } = useHistory();
  const [confirming, setConfirming] = useState(false);

  const entries = list
    .map((e) => ({ ...e, video: getVideoById(e.id) }))
    .filter((e): e is typeof e & { video: NonNullable<typeof e.video> } => Boolean(e.video));

  return (
    <div className="mx-auto max-w-4xl px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 animate-fade-up md:mb-7">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white md:text-3xl">
            <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/25 to-violet-600/25 ring-1 ring-brand-500/30">
              <HistoryIcon className="size-5 text-brand-300" aria-hidden />
            </span>
            Watch History
          </h1>
          <p className="mt-2 text-sm text-fog-500">
            Stored privately in this browser only — never uploaded anywhere.
          </p>
        </div>
        {entries.length > 0 && (
          <div className="flex items-center gap-2">
            {confirming && (
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-9 rounded-full border border-white/10 px-4 text-xs font-semibold text-fog-400 transition hover:text-white"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (confirming) {
                  clear();
                  setConfirming(false);
                } else {
                  setConfirming(true);
                  window.setTimeout(() => setConfirming(false), 4000);
                }
              }}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-semibold text-white transition active:scale-95",
                confirming ? "bg-red-600 hover:bg-red-500" : "border border-white/10 bg-ink-800 text-fog-300 hover:border-red-500/50 hover:text-red-300"
              )}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {confirming ? "Confirm clear all" : "Clear all"}
            </button>
          </div>
        )}
      </header>

      {entries.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No watch history yet"
          body="Videos you watch will appear here so you can pick up where you left off."
          action={
            <Link
              to="/explore"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-6 text-sm font-semibold text-white transition hover:brightness-110"
            >
              <Compass className="size-4" aria-hidden />
              Start exploring
            </Link>
          }
        />
      ) : (
        <ol className="space-y-1 animate-fade-up">
          {entries.map(({ id, at, video }) => (
            <li key={`${id}-${at}`} className="group flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/4">
              <Link to={`/watch/${video.id}`} className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8 sm:w-40">
                <img
                  src={video.thumbnail}
                  alt={`${video.title} thumbnail`}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <span className="glass absolute bottom-1 right-1 rounded px-1 py-px text-[10px] font-semibold text-white">
                  {video.durationLabel}
                </span>
              </Link>
              <div className="min-w-0 flex-1 py-1">
                <Link to={`/watch/${video.id}`} className="line-clamp-2 text-sm font-medium leading-snug text-fog-100 transition hover:text-brand-300">
                  {video.title}
                </Link>
                <p className="mt-1 truncate text-xs text-fog-500">
                  {categoryName(video.category)} · {video.viewsLabel} views
                </p>
                <p className="mt-0.5 text-[11px] text-fog-600">Watched {watchedAgo(at)}</p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${video.title} from history`}
                onClick={() => remove(id)}
                className="grid size-9 shrink-0 place-items-center rounded-full text-fog-500 opacity-60 transition hover:bg-white/8 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                <X className="size-4.5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
