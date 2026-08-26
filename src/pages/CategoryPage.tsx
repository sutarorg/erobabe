import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FolderSearch } from "lucide-react";
import { BROWSE_CATEGORIES, byCategory, categoryBySlug, type Video } from "@/data/videos";
import { EmptyState, VideoGrid, categoryIcon } from "@/components/Sections";
import { useDocumentTitle } from "@/hooks/store";
import { cn } from "@/lib/format";

type Sort = "popular" | "newest" | "views";

const SORTS: { key: Sort; label: string }[] = [
  { key: "popular", label: "Popular" },
  { key: "newest", label: "Newest" },
  { key: "views", label: "Most Viewed" },
];

function sortVideos(videos: Video[], sort: Sort): Video[] {
  const arr = [...videos];
  if (sort === "newest") return arr.sort((a, b) => a.daysAgo - b.daysAgo);
  if (sort === "views") return arr.sort((a, b) => b.views - a.views);
  return arr.sort((a, b) => b.score - a.score);
}

export default function CategoryPage() {
  const { slug } = useParams();
  const category = slug ? categoryBySlug.get(slug) : undefined;
  const isReal = category && !category.href && BROWSE_CATEGORIES.some((c) => c.slug === slug);
  const [sort, setSort] = useState<Sort>("popular");

  useDocumentTitle(isReal ? category.name : "Category not found");

  const videos = useMemo(
    () => (isReal ? sortVideos(byCategory(category.slug), sort) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isReal, category?.slug, sort]
  );

  if (!isReal) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-16 md:px-8">
        <EmptyState
          icon={FolderSearch}
          title="Category not found"
          body={`We couldn't find a category called "${slug ?? ""}". It may have been renamed or removed.`}
          action={
            <Link
              to="/categories"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-6 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Browse all categories
            </Link>
          }
        />
      </div>
    );
  }

  const Icon = categoryIcon(category.slug);

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-4 md:px-8 md:pt-6">
      {/* Banner */}
      <header className="relative mb-6 overflow-hidden rounded-2xl ring-1 ring-white/10 animate-fade-up md:mb-8 md:rounded-3xl">
        <img src={category.image} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        <div className={cn("absolute inset-0 bg-gradient-to-r to-transparent", category.gradient)} aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/30 to-transparent" aria-hidden />
        <div className="relative flex min-h-[150px] flex-col justify-end p-5 sm:min-h-[180px] sm:p-8">
          <Link
            to="/categories"
            className="mb-3 inline-flex w-fit items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-white/60 transition hover:text-white"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All categories
          </Link>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl">
            <span className="grid size-10 place-items-center rounded-xl bg-black/40 ring-1 ring-white/20 backdrop-blur md:size-12">
              <Icon className="size-5 md:size-6" aria-hidden />
            </span>
            {category.name}
          </h1>
          <p className="mt-2 text-xs text-white/70 sm:text-sm">
            {videos.length} videos · {category.blurb}
          </p>
        </div>
      </header>

      {/* Sort control */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-fog-600">
          Sorted by <span className="text-fog-300">{SORTS.find((s) => s.key === sort)?.label}</span>
        </p>
        <div role="tablist" aria-label="Sort videos" className="flex rounded-full border border-white/8 bg-ink-800/70 p-1">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={sort === s.key}
              onClick={() => setSort(s.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition sm:px-4",
                sort === s.key
                  ? "bg-gradient-to-r from-brand-500 to-violet-600 text-white"
                  : "text-fog-400 hover:text-white"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <VideoGrid videos={videos} />
    </div>
  );
}
