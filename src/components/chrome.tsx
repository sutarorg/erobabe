/**
 * Application chrome: Logo, AgeGate, Header (+ search), DesktopSidebar,
 * MobileBottomNav, MobileDrawer, Footer and the PublicLayout shell.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bookmark, Clock, Compass, Flame, History, Home, Info, LayoutGrid,
  Menu, MoreHorizontal, Search, Settings, ShieldAlert, Sparkles,
  TrendingUp, X,
} from "lucide-react";
import { countByCategory, getCategories, getSettings, suggestionsFor } from "../lib/api";
import {
  clearRecentSearches, confirmAge, getPrefs, getRecentSearches,
  getSidebarCollapsed, isAgeConfirmed, pushRecentSearch, setPrefs,
  setSidebarCollapsed, useDebounced, useStoreVersion,
} from "../lib/store";
import { cn } from "../utils/cn";
import { Button, Toggle } from "./ui";

export const OPEN_DRAWER = "eb:open-drawer";

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="ring-focus flex items-center gap-2 rounded-md" aria-label="EroBabe home">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-eb-rose to-eb-violet font-display text-sm font-bold text-white shadow-lg shadow-eb-rose/30">
        e
      </span>
      {!compact && (
        <span className="font-display text-lg font-bold tracking-tight text-white">
          Ero<span className="text-gradient">Babe</span>
        </span>
      )}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Age gate                                                            */
/* ------------------------------------------------------------------ */

export function AgeGate() {
  const [open, setOpen] = useState(() => !isAgeConfirmed());
  const settings = getSettings();
  if (!open || !settings.ageGateEnabled) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-eb-950/90 p-5 backdrop-blur-2xl" role="dialog" aria-modal="true" aria-label="Age verification">
      <div className="anim-fade-up w-full max-w-md rounded-3xl border border-eb-line bg-eb-900/90 p-8 text-center shadow-2xl shadow-eb-rose/5">
        <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-eb-rose to-eb-violet font-display text-2xl font-bold text-white shadow-xl shadow-eb-rose/30">
          e
        </span>
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-eb-rose/30 bg-eb-rose/10 px-3 py-1 text-[11px] font-bold tracking-widest text-eb-rose-soft">
          <ShieldAlert size={12} /> 18+ ADULTS ONLY
        </div>
        <h1 className="font-display text-2xl font-bold text-white">
          Ero<span className="text-gradient">Babe</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-eb-muted">{settings.ageGateMessage}</p>
        <p className="mt-2 text-xs leading-relaxed text-eb-faint">
          This site contains adult-oriented content. All demo content is fictional and used for interface demonstration only.
        </p>
        <div className="mt-7 grid gap-2.5">
          <Button
            size="lg"
            onClick={() => {
              confirmAge();
              setOpen(false);
            }}
          >
            I am 18 or older — Enter
          </Button>
          <Button variant="ghost" size="lg" onClick={() => (window.location.href = "https://www.google.com")}>
            Leave
          </Button>
        </div>
        <p className="mt-5 text-[10px] text-eb-faint">By entering you agree to our Terms of Service and Age Policy.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search bar with suggestions                                         */
/* ------------------------------------------------------------------ */

export function SearchBar({ autoFocus, onNavigate, className }: { autoFocus?: boolean; onNavigate?: () => void; className?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useStoreVersion(); // refresh recent searches
  const debounced = useDebounced(q, 120);
  const suggestions = suggestionsFor(debounced);
  const recent = getRecentSearches();

  const go = (term: string) => {
    const t = term.trim();
    if (!t) return;
    pushRecentSearch(t);
    setOpen(false);
    onNavigate?.();
    navigate(`/search?q=${encodeURIComponent(t)}`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(q);
  };

  return (
    <div className={cn("relative", className)}>
      <form onSubmit={submit} role="search" className="group flex h-10 items-center overflow-hidden rounded-full border border-eb-line bg-eb-850 transition focus-within:border-eb-rose/50 focus-within:bg-eb-800">
        <Search size={15} className="ml-4 shrink-0 text-eb-faint" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          autoFocus={autoFocus}
          placeholder="Search videos, categories, tags…"
          aria-label="Search videos"
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-eb-faint"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="cursor-pointer px-2 text-eb-faint hover:text-white">
            <X size={14} />
          </button>
        )}
        <button type="submit" className="ring-focus hidden h-full cursor-pointer items-center gap-1.5 bg-gradient-to-r from-eb-rose to-eb-violet px-5 text-sm font-semibold text-white transition hover:brightness-110 sm:flex">
          Search
        </button>
      </form>

      {open && (suggestions.length > 0 || (!q && recent.length > 0)) && (
        <div className="anim-fade absolute inset-x-0 top-12 z-50 overflow-hidden rounded-2xl border border-eb-line bg-eb-850/95 shadow-2xl backdrop-blur-xl">
          {!q && recent.length > 0 && (
            <>
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-[10px] font-bold tracking-widest text-eb-faint uppercase">Recent searches</span>
                <button onClick={() => clearRecentSearches()} className="cursor-pointer text-[10px] font-semibold text-eb-rose-soft hover:text-eb-rose">
                  Clear
                </button>
              </div>
              {recent.map((r) => (
                <SuggestionRow key={r} icon={<Clock size={13} />} label={r} onPick={() => go(r)} />
              ))}
            </>
          )}
          {suggestions.map((s) => (
            <SuggestionRow key={s} icon={<Search size={13} />} label={s} onPick={() => go(s)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionRow({ icon, label, onPick }: { icon: React.ReactNode; label: string; onPick: () => void }) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm text-eb-muted transition hover:bg-white/5 hover:text-white"
    >
      <span className="text-eb-faint">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

const HEADER_LINKS = [
  { to: "/", label: "Home" },
  { to: "/trending", label: "Trending" },
  { to: "/popular", label: "Popular" },
  { to: "/new", label: "New" },
  { to: "/categories", label: "Categories" },
];

export function Header() {
  const [mobileSearch, setMobileSearch] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const collapsed = getSidebarCollapsed();
  const navigate = useNavigate();
  const location = useLocation();
  useStoreVersion();

  useEffect(() => {
    const open = () => setDrawer(true);
    window.addEventListener(OPEN_DRAWER, open);
    return () => window.removeEventListener(OPEN_DRAWER, open);
  }, []);
  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-eb-line glass">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 sm:px-5">
          {/* left */}
          <button
            onClick={() => {
              if (window.innerWidth >= 1024) setSidebarCollapsed(!collapsed);
              else setDrawer(true);
            }}
            aria-label="Toggle menu"
            className="ring-focus flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-eb-muted transition hover:bg-white/5 hover:text-white"
          >
            <Menu size={18} />
          </button>
          <Logo />

          {/* center search (desktop) */}
          <div className="mx-auto hidden w-full max-w-xl md:block">
            <SearchBar />
          </div>

          {/* right */}
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <nav className="mr-2 hidden items-center gap-0.5 xl:flex" aria-label="Primary">
              {HEADER_LINKS.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    cn(
                      "rounded-full px-3 py-1.5 text-[13px] font-medium transition",
                      isActive ? "bg-white/8 text-white" : "text-eb-muted hover:text-white"
                    )
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
            <button
              onClick={() => navigate("/history")}
              aria-label="Watch history"
              className="ring-focus hidden h-9 w-9 cursor-pointer items-center justify-center rounded-full text-eb-muted transition hover:bg-white/5 hover:text-white sm:flex"
            >
              <History size={17} />
            </button>
            <SettingsPopover />
            <button
              onClick={() => setMobileSearch((v) => !v)}
              aria-label="Search"
              className="ring-focus flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-eb-muted transition hover:bg-white/5 hover:text-white md:hidden"
            >
              <Search size={18} />
            </button>
          </div>
        </div>

        {/* mobile expanding search */}
        {mobileSearch && (
          <div className="anim-fade border-t border-eb-line px-3 py-2 md:hidden">
            <SearchBar autoFocus onNavigate={() => setMobileSearch(false)} />
          </div>
        )}
      </header>

      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} />
    </>
  );
}

function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefsState] = useState(getPrefs());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        className="ring-focus flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-eb-muted transition hover:bg-white/5 hover:text-white"
      >
        <Settings size={17} />
      </button>
      {open && (
        <div className="anim-fade absolute right-0 top-11 z-50 w-64 rounded-2xl border border-eb-line bg-eb-850 p-4 shadow-2xl">
          <p className="text-[10px] font-bold tracking-widest text-eb-faint uppercase">Playback</p>
          <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-eb-text">Hover previews</span>
            <Toggle
              on={prefs.autoplayPreviews}
              onChange={(v) => {
                setPrefs({ ...prefs, autoplayPreviews: v });
                setPrefsState({ ...prefs, autoplayPreviews: v });
              }}
              label="Toggle thumbnail hover previews"
            />
          </label>
          <div className="mt-4 border-t border-eb-line pt-3 text-[11px] leading-relaxed text-eb-faint">
            Theme: <span className="text-eb-muted">Cinematic Dark</span> — the only theme we ship.
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop sidebar                                                     */
/* ------------------------------------------------------------------ */

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/trending", label: "Trending", icon: Flame },
  { to: "/popular", label: "Popular", icon: TrendingUp },
  { to: "/new", label: "New", icon: Sparkles },
  { to: "/history", label: "History", icon: History },
];

export function DesktopSidebar() {
  const collapsed = getSidebarCollapsed();
  useStoreVersion();
  const categories = getCategories();
  return (
    <aside
      className={cn(
        "fixed top-14 bottom-0 left-0 z-40 hidden flex-col overflow-y-auto border-r border-eb-line bg-eb-900/60 backdrop-blur-xl transition-[width] duration-300 no-scrollbar lg:flex",
        collapsed ? "w-[76px]" : "w-60"
      )}
    >
      <nav className="flex flex-col gap-0.5 p-3" aria-label="Main">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            title={n.label}
            className={({ isActive }) =>
              cn(
                "ring-focus group relative flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[13px] font-medium transition",
                isActive ? "bg-white/7 text-white" : "text-eb-muted hover:bg-white/4 hover:text-white",
                collapsed && "justify-center px-0"
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-eb-rose to-eb-violet" />}
                <n.icon size={17} className="shrink-0" />
                {!collapsed && n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <>
          <div className="mx-4 my-2 border-t border-eb-line" />
          <p className="px-6 pt-1 pb-2 text-[10px] font-bold tracking-widest text-eb-faint uppercase">Categories</p>
          <nav className="flex flex-col gap-0.5 px-3" aria-label="Categories">
            {categories.filter((c) => !c.virtual).slice(0, 6).map((c) => (
              <NavLink
                key={c.slug}
                to={`/category/${c.slug}`}
                className={({ isActive }) =>
                  cn(
                    "ring-focus flex items-center justify-between rounded-xl px-3.5 py-2 text-[13px] font-medium transition",
                    isActive ? "bg-white/7 text-white" : "text-eb-muted hover:bg-white/4 hover:text-white"
                  )
                }
              >
                {c.name}
                <span className="text-[10px] text-eb-faint">{countByCategory(c.slug) || ""}</span>
              </NavLink>
            ))}
            <NavLink to="/categories" className="ring-focus rounded-xl px-3.5 py-2 text-[12px] font-semibold text-eb-rose-soft transition hover:text-eb-rose">
              All categories →
            </NavLink>
          </nav>

          <div className="mx-4 my-3 border-t border-eb-line" />
          <nav className="flex flex-col gap-0.5 px-3 pb-4 text-eb-faint" aria-label="Legal">
            {[
              ["/legal/about", "About"],
              ["/legal/privacy", "Privacy"],
              ["/legal/terms", "Terms"],
              ["/legal/dmca", "DMCA"],
              ["/legal/age-policy", "18+ Policy"],
            ].map(([to, label]) => (
              <Link key={to} to={to} className="ring-focus rounded-lg px-3.5 py-1.5 text-xs transition hover:text-white">
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto px-5 pb-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-eb-rose/30 bg-eb-rose/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-eb-rose-soft">
              <ShieldAlert size={11} /> 18+ ADULTS ONLY
            </span>
          </div>
        </>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile drawer                                                       */
/* ------------------------------------------------------------------ */

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] lg:hidden">
      <div className="anim-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-fade-up absolute top-0 bottom-0 left-0 flex w-72 flex-col overflow-y-auto border-r border-eb-line bg-eb-900 no-scrollbar">
        <div className="flex h-14 items-center justify-between border-b border-eb-line px-4">
          <Logo />
          <button onClick={onClose} aria-label="Close menu" className="ring-focus flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-eb-muted hover:bg-white/5 hover:text-white">
            <X size={17} />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5 p-3">
          {[...NAV, { to: "/saved", label: "Saved", icon: Bookmark }].filter((n) => n.to !== "/saved").map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-sm font-medium transition",
                  isActive ? "bg-white/7 text-white" : "text-eb-muted hover:bg-white/4 hover:text-white"
                )
              }
            >
              <n.icon size={17} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mx-4 border-t border-eb-line" />
        <p className="px-6 pt-4 pb-2 text-[10px] font-bold tracking-widest text-eb-faint uppercase">Categories</p>
        <div className="grid grid-cols-2 gap-1.5 px-4 pb-5">
          {getCategories().map((c) => (
            <Link
              key={c.slug}
              to={`/category/${c.slug}`}
              onClick={onClose}
              className="rounded-lg border border-eb-line bg-eb-850 px-3 py-2 text-xs font-medium text-eb-muted transition hover:border-eb-rose/40 hover:text-white"
            >
              {c.name}
            </Link>
          ))}
        </div>
        <div className="mt-auto px-5 pb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-eb-rose/30 bg-eb-rose/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-eb-rose-soft">
            <ShieldAlert size={11} /> 18+ ADULTS ONLY
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile bottom nav                                                   */
/* ------------------------------------------------------------------ */

const BOTTOM = [
  { to: "/", label: "Home", icon: Home },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/trending", label: "Trending", icon: Flame },
  { to: "/categories", label: "Categories", icon: LayoutGrid },
];

export function MobileBottomNav() {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-eb-line glass lg:hidden" aria-label="Mobile">
      <div className="grid h-16 grid-cols-5">
        {BOTTOM.map((b) => (
          <NavLink key={b.to} to={b.to} end={b.to === "/"} className={({ isActive }) => cn("ring-focus flex flex-col items-center justify-center gap-1 transition", isActive ? "text-white" : "text-eb-faint")}>
            {({ isActive }) => (
              <>
                <span className={cn("flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200", isActive && "bg-gradient-to-r from-eb-rose/25 to-eb-violet/25 text-eb-rose-soft")}>
                  <b.icon size={18} />
                </span>
                <span className="text-[9px] font-semibold tracking-wide">{b.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_DRAWER))}
          className="ring-focus flex cursor-pointer flex-col items-center justify-center gap-1 text-eb-faint"
          aria-label="More options"
        >
          <span className="flex h-8 w-14 items-center justify-center rounded-full">
            <MoreHorizontal size={18} />
          </span>
          <span className="text-[9px] font-semibold tracking-wide">More</span>
        </button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export function Footer() {
  const settings = getSettings();
  return (
    <footer className="mt-16 border-t border-eb-line bg-eb-900/50 px-4 pt-10 pb-28 sm:px-8 lg:pb-10">
      <div className="mx-auto max-w-[1600px]">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-eb-faint">
              {settings.siteTagline}. A cinematic 18+ discovery experience. All demo content is fictional and for interface demonstration purposes only.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-eb-rose/30 bg-eb-rose/10 px-3 py-1 text-[10px] font-bold tracking-wider text-eb-rose-soft">
              <ShieldAlert size={11} /> 18+ ADULTS ONLY
            </span>
          </div>
          <FooterCol
            title="Discover"
            links={[
              ["Trending", "/trending"],
              ["Popular", "/popular"],
              ["New Releases", "/new"],
              ["Explore", "/explore"],
              ["History", "/history"],
            ]}
          />
          <FooterCol title="Categories" links={getCategories().slice(3, 8).map((c) => [c.name, `/category/${c.slug}`] as [string, string])} />
          <FooterCol
            title="Legal"
            links={[
              ["Privacy Policy", "/legal/privacy"],
              ["Terms of Service", "/legal/terms"],
              ["DMCA", "/legal/dmca"],
              ["Age Policy", "/legal/age-policy"],
              ["Contact", "/legal/contact"],
            ]}
          />
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-eb-line pt-6 text-[11px] text-eb-faint sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} {settings.siteName}. All rights reserved. RTA · Adults Only.</p>
          <p className="flex items-center gap-1.5">
            <Info size={12} /> Static demo build — no real content is hosted.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="mb-3 text-[10px] font-bold tracking-widest text-eb-faint uppercase">{title}</p>
      <ul className="space-y-2">
        {links.map(([label, to]) => (
          <li key={to + label}>
            <Link to={to} className="ring-focus rounded text-[13px] text-eb-muted transition hover:text-white">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout + scroll restoration                                         */
/* ------------------------------------------------------------------ */

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo({ top: 0 }), [pathname]);
  return null;
}

export function PublicLayout() {
  const collapsed = getSidebarCollapsed();
  useStoreVersion();
  return (
    <div className="min-h-screen bg-eb-950">
      <AgeGate />
      <Header />
      <DesktopSidebar />
      <ScrollToTop />
      <div className={cn("pt-14 transition-[padding] duration-300", collapsed ? "lg:pl-[76px]" : "lg:pl-60")}>
        <main className="mx-auto min-h-[70vh] w-full max-w-[1600px] px-3 py-5 sm:px-6 lg:px-8">
          <Outlet />
        </main>
        <Footer />
      </div>
      <MobileBottomNav />
    </div>
  );
}
