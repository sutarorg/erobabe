import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Bookmark, Clock, Compass, FileWarning, Flame, Heart, History, Home, Info,
  ShieldAlert, ShieldCheck, ScrollText, TrendingUp, X, type LucideIcon,
} from "lucide-react";
import { Logo, AgeBadge } from "./Brand";
import { categoryIcon } from "./Sections";
import { BROWSE_CATEGORIES } from "@/data/videos";
import { useUi } from "@/context/ui";
import { cn } from "@/lib/format";

interface Item {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}

const MAIN: Item[] = [
  { to: "/", icon: Home, label: "Home", end: true },
  { to: "/explore", icon: Compass, label: "Explore" },
  { to: "/trending", icon: Flame, label: "Trending" },
  { to: "/popular", icon: TrendingUp, label: "Popular" },
  { to: "/new", icon: Clock, label: "New Releases" },
  { to: "/history", icon: History, label: "History" },
  { to: "/liked", icon: Heart, label: "Liked" },
  { to: "/watch-later", icon: Bookmark, label: "Watch Later" },
];

const INFO: Item[] = [
  { to: "/legal/about", icon: Info, label: "About" },
  { to: "/legal/privacy", icon: ShieldCheck, label: "Privacy" },
  { to: "/legal/terms", icon: ScrollText, label: "Terms" },
  { to: "/legal/dmca", icon: FileWarning, label: "DMCA" },
  { to: "/legal/age", icon: ShieldAlert, label: "Age Policy" },
];

function NavItem({ to, icon: Icon, label, collapsed, end }: Item & { collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-200",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-gradient-to-r from-brand-500/15 to-violet-600/10 text-white ring-1 ring-brand-500/25"
            : "text-fog-400 hover:bg-white/5 hover:text-white"
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "size-5 shrink-0 transition",
              isActive ? "text-brand-400" : "text-fog-500 group-hover:text-fog-300"
            )}
            aria-hidden
          />
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className={cn("flex flex-col gap-5 py-4", collapsed ? "px-2.5" : "px-3")} onClick={onNavigate}>
      <div className="flex flex-col gap-0.5">
        {MAIN.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        {!collapsed && (
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">Categories</p>
        )}
        {collapsed && <div aria-hidden className="mx-2 border-t border-white/5 pb-2" />}
        {BROWSE_CATEGORIES.map((c) => (
          <NavItem key={c.slug} to={`/category/${c.slug}`} icon={categoryIcon(c.slug, c.icon)} label={c.name} collapsed={collapsed} />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        {!collapsed && (
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">Information</p>
        )}
        {collapsed && <div aria-hidden className="mx-2 border-t border-white/5 pb-2" />}
        {INFO.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}
      </div>

      {!collapsed && (
        <div className="mx-3 mt-2 rounded-2xl border border-white/6 bg-ink-800/60 p-3.5">
          <AgeBadge />
          <p className="mt-2 text-[11px] leading-relaxed text-fog-600">
            Adults only. All content is intended for users aged 18 or older and should be accessed only where legally permitted.
          </p>
        </div>
      )}
    </nav>
  );
}

export function Sidebar() {
  const { collapsed, mobileNav, setMobileNav } = useUi();
  const location = useLocation();

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname, setMobileNav]);

  useEffect(() => {
    if (!mobileNav) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMobileNav(false);
    document.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", esc);
    };
  }, [mobileNav, setMobileNav]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 top-14 z-30 hidden flex-col border-r border-white/6 bg-ink-900/40 backdrop-blur transition-[width] duration-300 md:top-16 lg:flex",
          collapsed ? "w-[76px]" : "w-60"
        )}
      >
        <div className="no-scrollbar flex-1 overflow-y-auto">
          <SidebarNav collapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={() => setMobileNav(false)} />
          <div className="glass absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-white/8 bg-ink-900/95 animate-fade-in">
            <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/6 bg-ink-900/80 px-4 backdrop-blur">
              <Logo />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMobileNav(false)}
                className="grid size-9 place-items-center rounded-full text-fog-400 transition hover:bg-white/5 hover:text-white"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileNav(false)} />
          </div>
        </div>
      )}
    </>
  );
}
