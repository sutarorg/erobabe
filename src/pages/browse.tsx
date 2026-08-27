/**
 * Browsing pages: Explore, Popular/New listings, Categories,
 * Category details, History, Search results, Legal pages, 404.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Clock, Compass, FileQuestion, Flame, FolderOpen, Info, SearchX,
  ShieldAlert, Sparkles, Trash2, TrendingUp, X,
} from "lucide-react";
import { FALLBACK_THUMB, formatDuration, formatViews, timeAgo, type Category, type Video } from "../data/videos";
import { countByCategory, getCatalog, getCategories, listVideos, searchVideos } from "../lib/api";
import { getCategoryIcon } from "../lib/icons";
import {
  clearHistory, getHistory, getRecentSearches, pushRecentSearch,
  removeHistory, useDocumentTitle, useStoreVersion,
} from "../lib/store";
import { CategoryCard, VideoGrid } from "../components/video";
import { Button, Chip, EmptyState, GridSkeleton, SectionHeader } from "../components/ui";

/* ------------------------------------------------------------------ */
/* Explore                                                             */
/* ------------------------------------------------------------------ */

const EXPLORE_FILTERS = [
  { key: "all", label: "All", sort: "popular" as const },
  { key: "trending", label: "Trending", sort: "trending" as const },
  { key: "new", label: "New", sort: "newest" as const },
  { key: "popular", label: "Popular", sort: "popular" as const },
  { key: "viewed", label: "Most Viewed", sort: "viewed" as const },
  { key: "recent", label: "Recently Added", sort: "newest" as const },
];

export function ExplorePage() {
  useDocumentTitle("Explore");
  const [filter, setFilter] = useState("all");
  const [videos, setVideos] = useState<Video[] | null>(null);
  const active = EXPLORE_FILTERS.find((f) => f.key === filter)!;

  useEffect(() => {
    let live = true;
    setVideos(null);
    listVideos({ sort: active.sort, limit: 30 }).then((v) => live && setVideos(v));
    return () => {
      live = false;
    };
  }, [active.sort]);

  return (
    <div className="anim-fade-up space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">Explore</h1>
        <p className="mt-1 text-sm text-eb-muted">Discover something new across the entire catalog.</p>
      </header>

      {/* The 14 categories — each with its own unique icon (synced with /admin/categories) */}
      <section aria-label="Categories">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {getCategories().map((c) => (
            <CategoryTile key={c.slug} category={c} />
          ))}
        </div>
      </section>

      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {EXPLORE_FILTERS.map((f) => (
          <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </Chip>
        ))}
      </div>

      {videos ? <VideoGrid videos={videos} /> : <GridSkeleton count={10} />}

      <section>
        <SectionHeader title="Browse Categories" subtitle="Full-bleed looks at every corner of the library" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {getCategories().filter((c) => !c.virtual).slice(0, 10).map((c) => (
            <CategoryCard key={c.slug} category={c} count={countByCategory(c.slug)} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Compact category tile with its unique icon — the primary Explore rail. */
function CategoryTile({ category }: { category: Category }) {
  const Icon = getCategoryIcon(category.icon);
  const count = countByCategory(category.slug);
  return (
    <Link
      to={`/category/${category.slug}`}
      className="group ring-focus flex flex-col gap-3 rounded-2xl border border-eb-line bg-eb-900/60 p-4 transition duration-200 hover:border-eb-rose/40 hover:bg-eb-900"
      aria-label={`${category.name} — ${count} videos`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-eb-rose/25 to-eb-violet/25 text-eb-rose-soft transition-transform duration-200 group-hover:scale-110 group-hover:from-eb-rose group-hover:to-eb-violet group-hover:text-white">
        <Icon size={19} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-bold text-eb-text group-hover:text-white">{category.name}</span>
        <span className="mt-0.5 block text-[10px] text-eb-faint">{count} video{count === 1 ? "" : "s"}</span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Popular / New listing                                               */
/* ------------------------------------------------------------------ */

const LISTING_META = {
  popular: { title: "Popular", sub: "The most-watched videos of all time.", icon: TrendingUp, sort: "popular" as const },
  new: { title: "New Releases", sub: "The latest uploads, freshest first.", icon: Sparkles, sort: "newest" as const },
};

export function ListingPage({ kind }: { kind: keyof typeof LISTING_META }) {
  const meta = LISTING_META[kind];
  useDocumentTitle(meta.title);
  const [videos, setVideos] = useState<Video[] | null>(null);
  useStoreVersion();

  useEffect(() => {
    let live = true;
    listVideos({ sort: meta.sort, limit: 40 }).then((v) => live && setVideos(v));
    return () => {
      live = false;
    };
  }, [meta.sort]);

  return (
    <div className="anim-fade-up">
      <header className="mb-6 flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-eb-line bg-eb-800 text-eb-rose">
          <meta.icon size={20} />
        </span>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{meta.title}</h1>
          <p className="mt-0.5 text-sm text-eb-muted">{meta.sub}</p>
        </div>
      </header>
      {videos ? (videos.length ? <VideoGrid videos={videos} /> : <EmptyState icon={<FolderOpen size={26} />} title="Nothing here yet" body="Check back soon — new videos are added regularly." />) : <GridSkeleton count={10} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Categories index                                                    */
/* ------------------------------------------------------------------ */

export function CategoriesPage() {
  useDocumentTitle("Categories");
  useStoreVersion();
  return (
    <div className="anim-fade-up">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">Categories</h1>
        <p className="mt-1 text-sm text-eb-muted">Browse the full library by mood and style.</p>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {getCategories().map((c) => (
          <CategoryCard key={c.slug} category={c} count={countByCategory(c.slug)} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category details                                                    */
/* ------------------------------------------------------------------ */

const CAT_SORTS = [
  { key: "popular", label: "Popular" },
  { key: "newest", label: "Newest" },
  { key: "viewed", label: "Most Viewed" },
] as const;

export function CategoryPage() {
  const { slug = "" } = useParams();
  const category = getCategories().find((c) => c.slug === slug);
  useDocumentTitle(category ? category.name : "Category");
  const [sort, setSort] = useState<(typeof CAT_SORTS)[number]["key"]>("popular");
  const [videos, setVideos] = useState<Video[] | null>(null);
  useStoreVersion();

  useEffect(() => {
    let live = true;
    setVideos(null);
    listVideos({ category: slug, sort }).then((v) => live && setVideos(v));
    return () => {
      live = false;
    };
  }, [slug, sort]);

  if (!category) {
    return (
      <EmptyState
        icon={<FolderOpen size={26} />}
        title="Category not found"
        body={`The category "${slug}" doesn't exist on EroBabe.`}
        action={
          <Link to="/categories">
            <Button variant="outline">Browse all categories</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="anim-fade-up">
      <header className="relative mb-6 overflow-hidden rounded-3xl border border-eb-line">
        <img src={category.image} alt="" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="absolute inset-0 h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-r from-eb-950 via-eb-950/85 to-eb-950/30" />
        <div className="relative p-6 sm:p-9">
          {(() => {
            const CatIcon = getCategoryIcon(category.icon);
            return (
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-black/45 text-white backdrop-blur-md">
                <CatIcon size={20} />
              </span>
            );
          })()}
          <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">{category.name}</h1>
          <p className="mt-1.5 text-sm text-eb-muted">
            {category.blurb} <span className="text-eb-rose-soft">• {videos ? `${videos.length} videos` : "…"}</span>
          </p>
        </div>
      </header>

      <div className="mb-6 flex gap-2">
        {CAT_SORTS.map((s) => (
          <Chip key={s.key} active={sort === s.key} onClick={() => setSort(s.key)}>
            {s.label}
          </Chip>
        ))}
      </div>

      {videos ? (videos.length ? <VideoGrid videos={videos} /> : <EmptyState icon={<FolderOpen size={26} />} title="No videos in this category yet" body="Published videos will appear here automatically." />) : <GridSkeleton count={10} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function HistoryPage() {
  useDocumentTitle("History");
  useStoreVersion();
  const entries = getHistory();
  const catalog = getCatalog();
  const videos = entries.map((e) => catalog.find((v) => v.id === e.id)).filter(Boolean) as Video[];
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="anim-fade-up">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">Watch History</h1>
          <p className="mt-1 text-sm text-eb-muted">Stored locally on this device only. No account needed.</p>
        </div>
        {videos.length > 0 &&
          (confirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-eb-muted">Clear all history?</span>
              <Button size="sm" variant="danger" onClick={() => { clearHistory(); setConfirmClear(false); }}>
                Yes, clear
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirmClear(true)}>
              <Trash2 size={13} /> Clear all
            </Button>
          ))}
      </header>

      {videos.length === 0 ? (
        <EmptyState
          icon={<Clock size={26} />}
          title="No watch history yet"
          body="Videos you watch will appear here so you can find them again."
          action={
            <Link to="/">
              <Button>Start watching</Button>
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {videos.map((v) => (
            <li key={v.id} className="group flex items-center gap-3 rounded-2xl border border-eb-line bg-eb-900/50 p-2.5 transition hover:border-eb-line-strong sm:gap-4 sm:p-3">
              <Link to={`/watch/${v.id}`} className="ring-focus relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl bg-eb-800 sm:w-44">
                <img src={v.thumbnail} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_THUMB)} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{formatDuration(v.durationSec)}</span>
              </Link>
              <div className="min-w-0 flex-1">
                <Link to={`/watch/${v.id}`} className="ring-focus line-clamp-2 rounded text-sm font-semibold text-eb-text hover:text-white">
                  {v.title}
                </Link>
                <p className="mt-1 truncate text-xs text-eb-faint">
                  {formatViews(v.views)} views • {timeAgo(v.daysAgo)}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-eb-rose-soft/90">{v.performer}</p>
              </div>
              <button
                onClick={() => removeHistory(v.id)}
                aria-label={`Remove ${v.title} from history`}
                className="ring-focus flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-eb-faint transition hover:bg-white/5 hover:text-white"
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  useDocumentTitle(q ? `Search: ${q}` : "Search");
  const [results, setResults] = useState<Video[] | null>(null);
  useStoreVersion();

  useEffect(() => {
    let live = true;
    if (!q.trim()) {
      setResults([]);
      return;
    }
    pushRecentSearch(q);
    setResults(null);
    searchVideos(q).then((r) => live && setResults(r));
    return () => {
      live = false;
    };
  }, [q]);

  const recent = getRecentSearches();
  const popular = useMemo(() => getCatalog().sort((a, b) => b.views - a.views).slice(0, 6), []);

  if (!q.trim()) {
    return (
      <div className="anim-fade-up">
        <h1 className="font-display mb-6 text-2xl font-bold tracking-tight text-white sm:text-3xl">Search</h1>
        {recent.length > 0 && (
          <>
            <p className="mb-3 text-[10px] font-bold tracking-widest text-eb-faint uppercase">Recent searches</p>
            <div className="mb-8 flex flex-wrap gap-2">
              {recent.map((r) => (
                <Link key={r} to={`/search?q=${encodeURIComponent(r)}`} className="ring-focus flex h-8 items-center gap-2 rounded-full border border-eb-line-strong bg-eb-800 px-3.5 text-xs font-medium text-eb-muted transition hover:border-white/25 hover:text-white">
                  <Clock size={12} /> {r}
                </Link>
              ))}
            </div>
          </>
        )}
        <SectionHeader title="Popular right now" />
        <VideoGrid videos={popular} />
      </div>
    );
  }

  return (
    <div className="anim-fade-up">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Results for <span className="text-gradient">“{q}”</span>
        </h1>
        <p className="mt-1 text-sm text-eb-muted">{results ? `${results.length} video${results.length === 1 ? "" : "s"} found` : "Searching…"}</p>
      </header>
      {!results ? (
        <GridSkeleton count={10} />
      ) : results.length ? (
        <VideoGrid videos={results} />
      ) : (
        <EmptyState
          icon={<SearchX size={26} />}
          title="No videos found"
          body="Try a different search term, a category name, or a performer."
          action={
            <Link to="/explore">
              <Button variant="outline">Explore the catalog</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legal                                                               */
/* ------------------------------------------------------------------ */

const LEGAL: Record<string, { title: string; icon: typeof Info; body: string[] }> = {
  privacy: {
    title: "Privacy Policy",
    icon: ShieldAlert,
    body: [
      "This is a placeholder privacy policy for the EroBabe demonstration project. It does not constitute legal advice or a completed compliance document.",
      "EroBabe stores age confirmation, watch history, likes and saves exclusively in your browser's localStorage. No personal information is collected, transmitted or sold by this demo build.",
      "When connected to a production backend, only anonymous view events (video ID, timestamp, watch seconds) are recorded for analytics purposes.",
    ],
  },
  terms: {
    title: "Terms of Service",
    icon: FileQuestion,
    body: [
      "This is a placeholder terms page for the EroBabe demonstration project.",
      "EroBabe is an adults-only (18+) video discovery experience. By using the site you confirm you are of legal age in your jurisdiction.",
      "All demo titles, performers and imagery are fictional placeholders intended solely to demonstrate the product interface.",
    ],
  },
  dmca: {
    title: "DMCA",
    icon: Info,
    body: [
      "This is a placeholder DMCA page. No real content is hosted on this demonstration build.",
      "A production deployment of EroBabe would provide a designated copyright agent and a takedown request process here.",
    ],
  },
  "age-policy": {
    title: "Age Policy",
    icon: ShieldAlert,
    body: [
      "EroBabe is strictly restricted to adults aged 18 or older (or the age of majority in your jurisdiction).",
      "Access requires confirming your age through the entry gate. Confirmation is stored locally on your device only.",
      "Parents and guardians can use standard parental-control tools (RTA labeling is included in this site's metadata) to restrict access.",
    ],
  },
  contact: {
    title: "Contact",
    icon: Info,
    body: [
      "This is a placeholder contact page for the EroBabe demo.",
      "For questions about this demonstration project, reach out via the repository where the source is hosted.",
    ],
  },
  about: {
    title: "About EroBabe",
    icon: Flame,
    body: [
      "EroBabe is a premium, cinematic 18+ video discovery and streaming experience — built as a fully static React + Vite application.",
      "The interface demonstrates a complete discovery flow: browse, search, filter, watch and pick up where you left off. All content is fictional demo data.",
    ],
  },
};

export function LegalPage() {
  const { page = "about" } = useParams();
  const entry = LEGAL[page] ?? LEGAL.about;
  useDocumentTitle(entry.title);
  const Icon = entry.icon;
  return (
    <div className="anim-fade-up mx-auto max-w-2xl">
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-eb-line bg-eb-800 text-eb-rose">
        <Icon size={20} />
      </span>
      <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{entry.title}</h1>
      <div className="mt-5 space-y-4">
        {entry.body.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-eb-muted">
            {p}
          </p>
        ))}
      </div>
      <div className="mt-8 rounded-2xl border border-eb-line bg-eb-900/60 p-4 text-xs leading-relaxed text-eb-faint">
        Placeholder page — this static demo does not imply that real legal compliance has been completed.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 404                                                                 */
/* ------------------------------------------------------------------ */

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <div className="anim-fade-up flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-display bg-gradient-to-r from-eb-rose to-eb-violet bg-clip-text text-8xl font-bold text-transparent sm:text-9xl">404</p>
      <h1 className="font-display mt-4 text-xl font-bold text-white">This page slipped away</h1>
      <p className="mt-2 max-w-sm text-sm text-eb-muted">The link may be broken, or the video may have been unpublished.</p>
      <Link to="/" className="mt-7">
        <Button size="lg">
          <Compass size={16} /> Back to discovery
        </Button>
      </Link>
    </div>
  );
}
