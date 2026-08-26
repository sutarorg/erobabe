import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpDown, CalendarDays, Eye, Search, SearchX, X } from "lucide-react";
import { popularTags, searchVideos } from "@/data/videos";
import { useDocumentTitle, useRecentSearches } from "@/hooks/store";
import { SearchBar } from "@/components/SearchBar";
import { EmptyState, FilterChips, Tag, VideoGrid, type ChipOption } from "@/components/Sections";

const SORTS: ChipOption[] = [
  { key: "relevance", label: "Relevance", icon: ArrowUpDown },
  { key: "newest", label: "Newest", icon: CalendarDays },
  { key: "views", label: "Most Viewed", icon: Eye },
];

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [sort, setSort] = useState("relevance");
  const { list: recent, clear: clearRecent } = useRecentSearches();

  useDocumentTitle(q ? `Search: ${q}` : "Search");
  useEffect(() => setSort("relevance"), [q]);

  const results = useMemo(() => {
    if (!q) return [];
    const r = searchVideos(q);
    if (sort === "newest") return [...r].sort((a, b) => a.daysAgo - b.daysAgo);
    if (sort === "views") return [...r].sort((a, b) => b.views - a.views);
    return r;
  }, [q, sort]);

  /* ── Landing state (no query) ── */
  if (!q) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-14 md:pt-24">
        <div className="w-full text-center animate-fade-up">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-300">Search</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white md:text-4xl">
            Find your <span className="text-gradient">mood</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-fog-500">
            Search by title, category, tag, performer or duration — everything runs instantly in your browser.
          </p>
          <SearchBar size="lg" autoFocus className="mx-auto mt-7 max-w-xl text-left" />
        </div>

        {recent.length > 0 && (
          <div className="mt-8 w-full animate-fade-up">
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">Recent searches</p>
              <button
                type="button"
                onClick={clearRecent}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-fog-500 transition hover:text-white"
              >
                <X className="size-3" aria-hidden />
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.map((t) => (
                <Tag key={t} label={t} to={`/search?q=${encodeURIComponent(t)}`} className="px-3 py-1.5" />
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 w-full animate-fade-up" style={{ animationDelay: "80ms" }}>
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">Popular searches</p>
          <div className="flex flex-wrap gap-2">
            {popularTags.map((t) => (
              <Tag key={t} label={t} to={`/search?q=${encodeURIComponent(t)}`} className="px-3 py-1.5" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Results ── */
  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-5 animate-fade-up md:mb-7">
        <div className="md:hidden">
          <SearchBar placeholder="Search videos…" className="mb-4" />
        </div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-fog-600">Search results for</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white md:text-3xl">
          “{q}”
        </h1>
        <p className="mt-1.5 text-sm text-fog-500">
          {results.length} {results.length === 1 ? "video" : "videos"} found
        </p>
      </header>

      {results.length > 0 ? (
        <>
          <FilterChips ariaLabel="Sort results" options={SORTS} value={sort} onChange={setSort} className="mb-5" />
          <VideoGrid videos={results} />
        </>
      ) : (
        <EmptyState
          icon={SearchX}
          title={`No videos found for “${q}”`}
          body="Try a different search term, check your spelling, or browse one of these popular searches instead."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {popularTags.slice(0, 5).map((t) => (
                <Tag key={t} label={t} to={`/search?q=${encodeURIComponent(t)}`} className="px-3 py-1.5" />
              ))}
              <Link
                to="/trending"
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-500 to-violet-600 px-4 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110"
              >
                <Search className="size-3.5" aria-hidden />
                Browse trending
              </Link>
            </div>
          }
        />
      )}
    </div>
  );
}
