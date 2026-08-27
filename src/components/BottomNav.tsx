import { useEffect, useState } from "react";
import { NavLink, useLocation, Link } from "react-router-dom";
import { Clock, Compass, Flame, History, Home, LayoutGrid, MoreHorizontal, TrendingUp, X } from "lucide-react";
import { Logo } from "./Brand";
import { Toggle } from "./Sections";
import { useUi } from "@/context/ui";
import { cn } from "@/lib/format";

const TABS = [
  { to: "/", icon: Home, label: "Home", end: true },
  { to: "/explore", icon: Compass, label: "Explore" },
  { to: "/trending", icon: Flame, label: "Trending" },
  { to: "/categories", icon: LayoutGrid, label: "Categories" },
];

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, setPref } = useUi();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", esc);
    };
  }, [open, onClose]);

  if (!open) return null;

  const links = [
    { to: "/popular", icon: TrendingUp, label: "Popular" },
    { to: "/new", icon: Clock, label: "New" },
    { to: "/history", icon: History, label: "History" },
  ];
  const legal = [
    { to: "/legal/privacy", label: "Privacy" },
    { to: "/legal/terms", label: "Terms" },
    { to: "/legal/dmca", label: "DMCA" },
    { to: "/legal/age", label: "Age Policy" },
    { to: "/legal/about", label: "About" },
  ];

  return (
    <div className="fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true" aria-label="More options">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="glass absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/10 bg-ink-900/95 pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-fade-up">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/15" aria-hidden />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <Logo />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full text-fog-400 transition hover:bg-white/5 hover:text-white"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2.5 px-5 pt-2">
          {links.map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              onClick={onClose}
              className="flex flex-col items-center gap-2 rounded-2xl border border-white/6 bg-ink-800/70 py-4 text-xs font-medium text-fog-300 transition hover:border-brand-500/30 hover:text-white active:scale-95"
            >
              <Icon className="size-5 text-brand-400" aria-hidden />
              {label}
            </Link>
          ))}
        </div>

        <div className="mx-5 mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-2xl border border-white/6 bg-ink-800/70 px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-white">Autoplay next video</p>
              <p className="text-xs text-fog-500">Continue playing automatically</p>
            </div>
            <Toggle
              checked={prefs.autoplayNext}
              onChange={(v) => setPref("autoplayNext", v)}
              label="Toggle autoplay next video"
            />
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-white/6 bg-ink-800/70 px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-white">Mute on start</p>
              <p className="text-xs text-fog-500">Begin videos with sound off</p>
            </div>
            <Toggle
              checked={prefs.muteOnStart}
              onChange={(v) => setPref("muteOnStart", v)}
              label="Toggle mute on start"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 px-6 pt-4">
          {legal.map((l) => (
            <Link key={l.to} to={l.to} onClick={onClose} className="text-xs font-medium text-fog-500 transition hover:text-white">
              {l.label}
            </Link>
          ))}
        </div>
        <p className="px-6 pt-4 text-[11px] leading-relaxed text-fog-600">
          18+ Adults Only
        </p>
      </div>
    </div>
  );
}

export function BottomNav() {
  const [more, setMore] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMore(false);
  }, [location.pathname]);

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-white/8 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="grid grid-cols-5">
          {TABS.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-col items-center gap-1 pb-1.5 pt-2.5 text-[10px] font-medium transition",
                  isActive ? "text-brand-300" : "text-fog-500 hover:text-fog-300"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-brand-500 to-violet-500" />
                  )}
                  <Icon className="size-[22px]" strokeWidth={isActive ? 2.3 : 1.9} aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            aria-label="More options"
            onClick={() => setMore(true)}
            className="flex flex-col items-center gap-1 pb-1.5 pt-2.5 text-[10px] font-medium text-fog-500 transition hover:text-fog-300"
          >
            <MoreHorizontal className="size-[22px]" strokeWidth={1.9} aria-hidden />
            More
          </button>
        </div>
      </nav>
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </>
  );
}
