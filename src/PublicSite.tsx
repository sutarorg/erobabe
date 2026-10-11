import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdRail from "./components/AdRail";
import AgeGate from "./components/AgeGate";
import Categories from "./components/Categories";
import CategoriesPage from "./components/CategoriesPage";
import Footer from "./components/Footer";
import Header, { type NavKey } from "./components/Header";
import Hero from "./components/Hero";
import InlineAd from "./components/InlineAd";
import LatestPage from "./components/LatestPage";
import SignInModal from "./components/SignInModal";
import {
  AboutPage, ContactPage, FaqPage, PrivacyPage, RemovalPage, TermsPage,
} from "./components/StaticPages";
import VideoGrid from "./components/VideoGrid";
import VideoPage from "./components/VideoPage";
import VideoSection from "./components/VideoSection";
import {
  ALL_CATEGORIES, categoryFromSlug, categorySlug, FEATURED_VIDEOS, LATEST_VIDEOS, VIDEOS, type Video,
} from "./data/content";

/** Which header item lights up for each route. */
const NAV_FOR_PAGE: Record<string, NavKey> = {
  "": "home",
  categories: "categories",
  latest: "latest",
  toprated: "toprated",
};

/**
 * The legacy `src/` SPA tree is not part of the production build; this file is
 * kept only so the old screens still type-check. `BrowseView` was removed with
 * the public /browser page, so the listing renders inline below.
 */
function LegacyListingSection({
  eyebrow,
  title,
  videos,
  showFilters,
  activeCategory,
  onCategory,
  onClear,
  onOpen,
}: {
  eyebrow: string;
  title: string;
  videos: Video[];
  showFilters: boolean;
  activeCategory: string | null;
  onCategory: (label: string | null) => void;
  onClear: () => void;
  onOpen: (video: Video) => void;
}) {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 pt-5 @sm:px-5 @2xl:px-7">
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
      >
        ← Back to home
      </button>

      <p className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">{eyebrow}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
        <span className="text-[12px] tabular-nums text-ink-3">
          {videos.length} {videos.length === 1 ? "video" : "videos"}
        </span>
      </div>

      {showFilters && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          {["All", ...ALL_CATEGORIES.map((category) => category.label)].map((label) => {
            const active = label === "All" ? activeCategory === null : activeCategory === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onCategory(label === "All" ? null : label)}
                className={`rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors ${
                  active ? "border-accent bg-accent/15 text-accent" : "border-line text-ink-3 hover:border-ink-3 hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <VideoGrid videos={videos} onOpen={onOpen} />
      </div>
    </section>
  );
}

interface PublicSiteProps {
  /** Sub-path inside the site, e.g. "", "video/{slug}", "browse/all". */
  path: string;
  onRoute: (path: string) => void;
  onAdvertise: () => void;
  onAdmin?: () => void;
}

export default function PublicSite({ path, onRoute, onAdvertise, onAdmin }: PublicSiteProps) {
  /* ---- local view state (frontend only) -------------------------- */
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  /* ---- route parsing ---------------------------------------------- */
  const segments = path.split("/").filter(Boolean);
  const page = segments[0] ?? "";
  const activeVideo: Video | null =
    page === "video" ? VIDEOS.find((v) => v.id === segments[1]) ?? null : null;

  /** Listing routes: /toprated/{category|all}. */
  const isListPage = page === "toprated";
  const routeCategory =
    isListPage && segments[1] && segments[1] !== "all"
      ? categoryFromSlug(segments[1])
      : null;

  const trimmed = query.trim().toLowerCase();
  const isSearching = Boolean(trimmed);

  /* ---- scroll container + section anchors ------------------------ */
  const mainRef = useRef<HTMLElement>(null);
  const categoriesRef = useRef<HTMLElement>(null);
  const featuredRef = useRef<HTMLElement>(null);
  const latestRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [path]);

  const scrollTo = useCallback((ref: React.RefObject<HTMLElement | null>) => {
    requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, []);

  const openVideo = useCallback((v: Video) => onRoute(`video/${v.id}`), [onRoute]);

  const navigate = useCallback(
    (key: NavKey) => {
      setQuery("");
      switch (key) {
        case "home":
          onRoute("");
          break;
        case "categories":
          onRoute("categories");
          break;
        case "latest":
          onRoute("latest");
          break;
        case "toprated":
          onRoute("toprated/all");
          break;
      }
    },
    [onRoute]
  );

  /** Category chosen from a tile — always lands on the listing page. */
  const selectCategory = useCallback(
    (label: string) => {
      setQuery("");
      if (label === "More") {
        onRoute("categories");
        return;
      }
      onRoute(`toprated/${categorySlug(label)}`);
    },
    [onRoute]
  );

  /** Chip clicked inside a listing — keeps you on the same listing type. */
  const filterCategory = useCallback(
    (label: string | null) => {
      onRoute(`toprated/${label ? categorySlug(label) : "all"}`);
    },
    [onRoute, page]
  );

  /* ---- derived data ----------------------------------------------- */
  const listVideos = useMemo(() => {
    let out = [...VIDEOS];
    if (isSearching) {
      return out.filter(
        (v) =>
          v.title.toLowerCase().includes(trimmed) ||
          v.category.toLowerCase().includes(trimmed)
      );
    }
    if (page === "toprated") out.sort((a, b) => b.rating - a.rating || b.viewsNum - a.viewsNum);
    if (routeCategory) out = out.filter((v) => v.category === routeCategory);
    return out;
  }, [isSearching, trimmed, page, routeCategory]);

  /** Eyebrow + title for the listing header. */
  const { eyebrow, title } = useMemo(() => {
    if (isSearching) {
      return { eyebrow: "Search", title: `Results for “${query.trim()}”` };
    }
    if (page === "toprated") {
      return {
        eyebrow: "Top Rated",
        title: routeCategory ? `Top Rated ${routeCategory}` : "Top Rated All",
      };
    }
    return { eyebrow: "Top Rated", title: routeCategory ?? "Top Rated All" };
  }, [isSearching, query, page, routeCategory]);

  /** Featured: 4 rows × 5 columns = 20. Latest: 4 rows × 4 columns = 16. */
  const featuredVideos = useMemo(() => FEATURED_VIDEOS.slice(0, 20), []);
  const latestVideos = useMemo(() => LATEST_VIDEOS.slice(0, 16), []);

  const toggleLike = useCallback((id: string) => {
    setLikedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const goHome = useCallback(() => {
    setQuery("");
    onRoute("");
  }, [onRoute]);

  const effectiveNav: NavKey = isSearching ? "home" : NAV_FOR_PAGE[page] ?? "home";
  const showHome = !isSearching && page === "";

  return (
    <div className="grid h-full grid-cols-1 bg-void text-ink min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)]">
      {/* Left advertising rail (fixed, never scrolls) */}
      <AdRail side="left" start={1} onAdvertise={onAdvertise} />

      {/* Center panel — the actual erobabe website (scrollbar hidden by design) */}
      <main
        ref={mainRef}
        className="no-scrollbar @container relative h-full min-h-0 min-w-0 overflow-y-auto bg-panel"
      >
        <Header
          navActive={effectiveNav}
          onNavigate={navigate}
          query={query}
          onQueryChange={setQuery}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          user={user}
          onSignInClick={() => setSignInOpen(true)}
          onSignOut={() => setUser(null)}
        />

        {/* ---- search results take precedence over any route ---- */}
        {isSearching ? (
          <LegacyListingSection
            eyebrow={eyebrow}
            title={title}
            videos={listVideos}
            showFilters={false}
            activeCategory={null}
            onCategory={filterCategory}
            onClear={goHome}
            onOpen={openVideo}
          />
        ) : (
          <>
            {page === "video" && activeVideo && (
              <VideoPage
                key={activeVideo.id}
                video={activeVideo}
                liked={likedIds.includes(activeVideo.id)}
                onToggleLike={() => toggleLike(activeVideo.id)}
                onBack={goHome}
                onOpen={openVideo}
                onSelectCategory={selectCategory}
              />
            )}
            {page === "video" && !activeVideo && (
              <div className="mx-auto w-full max-w-[1200px] px-4 py-16 text-center @sm:px-5 @2xl:px-7">
                <p className="text-[16px] font-semibold text-ink">Video not found</p>
                <p className="mt-1 text-[12.5px] text-ink-3">
                  This scene may have been removed or the link is incorrect.
                </p>
                <button
                  type="button"
                  onClick={goHome}
                  className="mx-auto mt-4 flex h-9 items-center justify-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-soft"
                >
                  Back to home
                </button>
              </div>
            )}

            {isListPage && (
              <LegacyListingSection
                eyebrow={eyebrow}
                title={title}
                videos={listVideos}
                showFilters
                activeCategory={routeCategory}
                onCategory={filterCategory}
                onClear={goHome}
                onOpen={openVideo}
              />
            )}

            {page === "categories" && <CategoriesPage onSelect={selectCategory} />}
            {page === "latest" && <LatestPage onOpen={openVideo} />}
            {page === "about" && <AboutPage onBack={goHome} onAdvertise={onAdvertise} />}
            {page === "terms" && <TermsPage onBack={goHome} />}
            {page === "privacy" && <PrivacyPage onBack={goHome} />}
            {page === "contact" && <ContactPage onBack={goHome} />}
            {page === "faq" && <FaqPage onBack={goHome} />}
            {page === "removal" && <RemovalPage onBack={goHome} />}
          </>
        )}

        {/* ---- home surface ---- */}
        {showHome && (
          <div className="mx-auto w-full max-w-[1200px] px-4 @sm:px-5 @2xl:px-7">
            <Hero
              onExplore={() => scrollTo(featuredRef)}
              onBrowseCategories={() => onRoute("categories")}
            />

            <section ref={categoriesRef} className="mt-7 scroll-mt-[68px]">
              <Categories activeCategory={null} onSelect={selectCategory} />
            </section>

            {/* Featured — 20 scenes in 4 rows × 5 columns, no horizontal scroll */}
            <section ref={featuredRef} className="mt-8 scroll-mt-[68px]">
              <VideoSection title="Featured Videos">
                <VideoGrid
                  videos={featuredVideos}
                  onOpen={openVideo}
                  maxColumns={5}
                  className="video-grid mt-3.5"
                />
              </VideoSection>
            </section>

            {/* In-flow ad placement for tablet & mobile (rails are hidden) */}
            <div className="mt-8">
              <InlineAd onAdvertise={onAdvertise} />
            </div>

            {/* Latest — 16 scenes in 4 rows × 4 columns */}
            <section ref={latestRef} className="mt-8 scroll-mt-[68px]">
              <VideoSection title="Latest Videos" onViewAll={() => onRoute("latest")}>
                <VideoGrid
                  videos={latestVideos}
                  onOpen={openVideo}
                  maxColumns={4}
                  className="video-grid mt-3.5"
                />
              </VideoSection>
            </section>
          </div>
        )}

        <Footer
          onNavigate={navigate}
          onOpenPage={(p) => onRoute(p)}
          onAdvertise={onAdvertise}
          onAdmin={onAdmin}
        />
      </main>

      {/* Right advertising rail (fixed, never scrolls) */}
      <AdRail side="right" start={6} onAdvertise={onAdvertise} />

      {/* Overlays */}
      {signInOpen && (
        <SignInModal
          onClose={() => setSignInOpen(false)}
          onSignIn={(name) => {
            setUser({ name });
            setSignInOpen(false);
          }}
        />
      )}

      {/* 18+ gate sits above every other layer on the public website */}
      <AgeGate />
    </div>
  );
}
