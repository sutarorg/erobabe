"use client";
import Link from "next/link";
import { LayoutDashboard, LogOut, Menu, Search, User, X } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { LOGO_URL } from "../data/content";
import { cn } from "../utils/cn";

export type NavKey = "home" | "categories" | "latest" | "toprated";

export const NAV_HREFS: Record<NavKey, string> = {
  home: "/",
  categories: "/categories",
  latest: "/latest",
  toprated: "/popular",
};

const NAV_ITEMS: { key: NavKey; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "categories", label: "Categories" },
  { key: "latest", label: "Latest" },
  { key: "toprated", label: "Popular" },
];

/** The signed-in account shown in the right-hand cluster. */
export type HeaderUser = {
  name: string;
  /** `admin` gets the admin dashboard, anything else the advertiser portal. */
  role?: string | null;
};

interface HeaderProps {
  /**
   * The active primary-navigation key, or `null` on a page that is not one of
   * them (/about, /privacy, /terms, /video/…). `null` leaves every item
   * un-highlighted instead of lighting up “Home” everywhere.
   */
  navActive: NavKey | null;
  onNavigate: (key: NavKey) => void;
  query: string;
  onQueryChange: (value: string) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  user: HeaderUser | null;
  /** Where “Dashboard” goes. Defaults by role: /admin or /advertiser. */
  dashboardHref?: string;
  onSignInClick: () => void;
  onSignOut: () => void;
  /** Prefetching <Link> navigation for the Next.js site. */
  useLinks?: boolean;
}

/** Where a signed-in account's dashboard lives. */
export function dashboardHrefFor(user: HeaderUser | null): string {
  return user?.role === "admin" ? "/admin" : "/advertiser";
}

export default function Header({
  navActive,
  onNavigate,
  query,
  onQueryChange,
  searchOpen,
  onSearchOpenChange,
  menuOpen,
  onMenuOpenChange,
  user,
  dashboardHref,
  onSignInClick,
  onSignOut,
  useLinks = false,
}: HeaderProps) {
  const dashboardTo = dashboardHref || dashboardHrefFor(user);
  const handleSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) onQueryChange("");
      else onSearchOpenChange(false);
    }
  };

  const closeSearch = () => {
    onQueryChange("");
    onSearchOpenChange(false);
  };

  const submitSearch = (e: FormEvent) => e.preventDefault();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-panel/95 backdrop-blur-md">
      <div className="relative mx-auto flex h-14 w-full max-w-[1200px] items-center gap-5 px-4 @sm:px-5 @2xl:px-7">
        {/* Brand */}
        {useLinks ? (
          <Link
            href="/"
            prefetch
            className="flex shrink-0 items-center gap-2"
            aria-label="erobabe — home"
          >
            <img
              src={LOGO_URL}
              alt="erobabe logo"
              className="h-7 w-auto object-contain"
              draggable={false}
            />
            <span className="text-[15px] font-bold tracking-tight text-ink">
              erobabe<span className="text-accent">.</span>
            </span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className="flex shrink-0 items-center gap-2"
            aria-label="erobabe — home"
          >
            <img
              src={LOGO_URL}
              alt="erobabe logo"
              className="h-7 w-auto object-contain"
              draggable={false}
            />
            <span className="text-[15px] font-bold tracking-tight text-ink">
              erobabe<span className="text-accent">.</span>
            </span>
          </button>
        )}

        {/* Desktop / wide-container navigation */}
        <nav
          aria-label="Primary"
          className="hidden h-full items-stretch gap-2 min-[1000px]:flex min-[1200px]:gap-3"
        >
          {NAV_ITEMS.map((item) => {
            const active = navActive === item.key;
            const className = cn(
              "relative flex items-center px-2 text-[13px] font-medium transition-colors duration-150 min-[1000px]:px-1.5",
              active ? "text-accent" : "text-ink-2 hover:text-ink",
            );
            const inner = (
              <>
                {item.label}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-0 bottom-0 mx-auto h-[2px] w-[18px] rounded-full bg-accent transition-opacity duration-150",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </>
            );
            return useLinks ? (
              <Link
                key={item.key}
                href={NAV_HREFS[item.key]}
                prefetch
                aria-current={active ? "page" : undefined}
                className={className}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                aria-current={active ? "page" : undefined}
                className={className}
              >
                {inner}
              </button>
            );
          })}
        </nav>

        {/* Right controls */}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {searchOpen ? (
            <form
              onSubmit={submitSearch}
              className="flex h-8 w-[168px] items-center gap-1 rounded-md border border-line bg-card pl-2.5 pr-1 transition-colors focus-within:border-accent/60 @sm:w-[200px] min-[1000px]:w-[128px]"
              role="search"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={handleSearchKey}
                type="text"
                placeholder="Search videos…"
                aria-label="Search videos"
                className="w-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
              />
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Clear and close search"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 transition-colors hover:bg-white/5 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => onSearchOpenChange(true)}
              aria-label="Open search"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-card hover:text-ink"
            >
              <Search className="h-4 w-4" aria-hidden />
            </button>
          )}

          {user ? (
            <>
              <Link
                href={dashboardTo}
                prefetch
                className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-soft @sm:px-3"
              >
                <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
                Dashboard
              </Link>
              <button
                type="button"
                onClick={onSignOut}
                title={`Signed in as ${user.name} — click to sign out`}
                aria-label={`Sign out (${user.name})`}
                className="flex h-8 items-center gap-2 rounded-md border border-line bg-card px-2 transition-colors hover:border-zinc-600"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <LogOut className="h-3.5 w-3.5 text-ink-3" aria-hidden />
              </button>
            </>
          ) : useLinks ? (
            <Link
              href="/auth/sign-in"
              prefetch
              className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-zinc-600 @sm:px-3"
            >
              <User className="h-3.5 w-3.5 text-ink-2" aria-hidden />
              <span className="hidden @sm:inline">Sign In</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={onSignInClick}
              className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-zinc-600 @sm:px-3"
            >
              <User className="h-3.5 w-3.5 text-ink-2" aria-hidden />
              <span className="hidden @sm:inline">Sign In</span>
            </button>
          )}

          {/* Compact menu toggle (narrow center panel / mobile) */}
          <button
            type="button"
            onClick={() => onMenuOpenChange(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-card hover:text-ink min-[1000px]:hidden"
          >
            {menuOpen ? (
              <X className="h-4 w-4" aria-hidden />
            ) : (
              <Menu className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {/* Compact dropdown navigation */}
      {menuOpen && (
        <nav
          aria-label="Mobile"
          className="border-t border-line bg-panel px-4 py-2 @sm:px-5 min-[1000px]:hidden @2xl:px-7"
        >
          {NAV_ITEMS.map((item) => {
            const active = navActive === item.key;
            const className = cn(
              "flex w-full items-center justify-between rounded-md px-2 py-2.5 text-left text-[13.5px] font-medium transition-colors",
              active
                ? "text-accent"
                : "text-ink-2 hover:bg-card hover:text-ink",
            );
            const inner = (
              <>
                {item.label}
                {active && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                    aria-hidden
                  />
                )}
              </>
            );
            return useLinks ? (
              <Link
                key={item.key}
                href={NAV_HREFS[item.key]}
                prefetch
                aria-current={active ? "page" : undefined}
                className={className}
                onClick={() => onMenuOpenChange(false)}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  onNavigate(item.key);
                  onMenuOpenChange(false);
                }}
                aria-current={active ? "page" : undefined}
                className={className}
              >
                {inner}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
