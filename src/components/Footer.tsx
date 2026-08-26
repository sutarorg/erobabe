import { Link } from "react-router-dom";
import { Logo, AgeBadge } from "./Brand";
import { BROWSE_CATEGORIES, demoNotice } from "@/data/videos";

const EXPLORE = [
  { to: "/", label: "Home" },
  { to: "/explore", label: "Explore" },
  { to: "/trending", label: "Trending" },
  { to: "/popular", label: "Popular" },
  { to: "/new", label: "New Releases" },
  { to: "/categories", label: "Categories" },
];

const LEGAL = [
  { to: "/legal/privacy", label: "Privacy Policy" },
  { to: "/legal/terms", label: "Terms of Service" },
  { to: "/legal/dmca", label: "DMCA" },
  { to: "/legal/age", label: "Age Policy" },
  { to: "/legal/contact", label: "Contact" },
];

export function Footer() {
  return (
    <footer className="mb-16 mt-14 border-t border-white/6 bg-ink-900/30 lg:mb-0">
      <div className="mx-auto max-w-[1600px] px-4 py-10 md:px-8 md:py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <div className="mt-4 flex items-center gap-2">
              <AgeBadge />
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-fog-500">
                RTA
              </span>
            </div>
            <p className="mt-4 max-w-sm text-xs leading-relaxed text-fog-500">{demoNotice}</p>
          </div>

          <nav aria-label="Explore" className="text-sm">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">Explore</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-1">
              {EXPLORE.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-fog-400 transition hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Categories" className="text-sm">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">Categories</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-1">
              {BROWSE_CATEGORIES.slice(0, 6).map((c) => (
                <li key={c.slug}>
                  <Link to={`/category/${c.slug}`} className="text-fog-400 transition hover:text-white">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Legal" className="text-sm">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog-600">Legal</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-1">
              {LEGAL.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-fog-400 transition hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/6 pt-6 text-xs text-fog-600 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} EroBabe</p>
          <p className="font-medium text-fog-500">18+ Adults Only</p>
        </div>
      </div>
    </footer>
  );
}
