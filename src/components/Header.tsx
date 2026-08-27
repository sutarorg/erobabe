import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Flame, History, Menu, PanelLeft, Search, Settings2, X } from "lucide-react";
import { Logo, AgeBadge } from "./Brand";
import { SearchBar } from "./SearchBar";
import { Toggle } from "./Sections";
import { useUi } from "@/context/ui";
import { cn } from "@/lib/format";

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { prefs, setPref } = useUi();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Playback settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-full text-fog-400 transition hover:bg-white/5 hover:text-white"
      >
        <Settings2 className="size-5" aria-hidden />
      </button>
      {open && (
        <div className="glass absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 shadow-2xl animate-scale-in">
          <p className="border-b border-white/5 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">
            Playback preferences
          </p>
          <div className="flex items-start justify-between gap-4 border-b border-white/5 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-white">Autoplay next video</p>
              <p className="mt-0.5 text-xs leading-relaxed text-fog-500">
                Continue to the next recommended video automatically.
              </p>
            </div>
            <Toggle
              checked={prefs.autoplayNext}
              onChange={(v) => setPref("autoplayNext", v)}
              label="Toggle autoplay next video"
            />
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-white">Mute on start</p>
              <p className="mt-0.5 text-xs leading-relaxed text-fog-500">
                Begin every video with the sound muted.
              </p>
            </div>
            <Toggle
              checked={prefs.muteOnStart}
              onChange={(v) => setPref("muteOnStart", v)}
              label="Toggle mute on start"
            />
          </div>
        </div>
      )}
    </div>
  );
}

const iconBtn =
  "grid size-10 place-items-center rounded-full text-fog-400 transition hover:bg-white/5 hover:text-white";

export function Header() {
  const { toggleCollapsed, setMobileNav, mobileSearch, setMobileSearch } = useUi();

  return (
    <header className="glass fixed inset-x-0 top-0 z-40 border-b border-white/6">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <div className="flex h-14 items-center gap-2 px-3 md:h-16 md:gap-4 md:px-5">
        {/* Mobile: menu / Desktop: collapse */}
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileNav(true)}
          className={cn(iconBtn, "lg:hidden")}
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Toggle sidebar"
          onClick={toggleCollapsed}
          className={cn(iconBtn, "hidden lg:grid")}
        >
          <PanelLeft className="size-5" aria-hidden />
        </button>

        <Logo />

        {/* Desktop search */}
        <div className="mx-auto hidden w-full max-w-xl md:block">
          <SearchBar />
        </div>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <AgeBadge className="mr-1 hidden xl:inline-flex" />
          <NavLink
            to="/trending"
            aria-label="Trending"
            className={({ isActive }) =>
              cn(iconBtn, "hidden sm:grid", isActive && "bg-white/5 text-brand-400")
            }
          >
            <Flame className="size-5" aria-hidden />
          </NavLink>
          <NavLink
            to="/history"
            aria-label="Watch history"
            className={({ isActive }) =>
              cn(iconBtn, "hidden sm:grid", isActive && "bg-white/5 text-brand-400")
            }
          >
            <History className="size-5" aria-hidden />
          </NavLink>
          <SettingsMenu />
          <button
            type="button"
            aria-label="Open search"
            onClick={() => setMobileSearch(!mobileSearch)}
            className={cn(iconBtn, "md:hidden")}
          >
            {mobileSearch ? <X className="size-5" aria-hidden /> : <Search className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {/* Mobile expanding search */}
      {mobileSearch && (
        <div className="border-t border-white/6 px-3 pb-3 pt-2.5 md:hidden animate-fade-in">
          <SearchBar autoFocus onNavigate={() => setMobileSearch(false)} placeholder="Search videos…" />
        </div>
      )}
    </header>
  );
}
