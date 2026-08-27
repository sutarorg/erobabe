/**
 * Admin module shell: auth guard, login screen, professional CMS layout,
 * and the admin route table.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Activity, BarChart3, ExternalLink, Eye, Film, FolderOpen, HardDrive,
  LayoutDashboard, Lock, LogOut, Menu, Search, Settings, Tags, Upload, X,
} from "lucide-react";
import { AdminProvider, useAdmin } from "./store";
import { AdminDashboard } from "./dashboard";
import { AdminVideosPage, AdminVideoEditorPage } from "./videos";
import { AdminUploadPage } from "./upload";
import {
  AdminActivityPage, AdminAnalyticsPage, AdminCategoriesPage,
  AdminSettingsPage, AdminStoragePage, AdminTagsPage,
} from "./misc";
import { cn } from "../utils/cn";
import { Button } from "../components/ui";

export default function AdminApp() {
  return (
    <AdminProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="videos" element={<AdminVideosPage />} />
            <Route path="videos/new" element={<AdminUploadPage />} />
            <Route path="videos/:id/edit" element={<AdminVideoEditorPage />} />
            <Route path="categories" element={<AdminCategoriesPage />} />
            <Route path="tags" element={<AdminTagsPage />} />
            <Route path="analytics" element={<AdminAnalyticsPage />} />
            <Route path="storage" element={<AdminStoragePage />} />
            <Route path="activity" element={<AdminActivityPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Route>
      </Routes>
    </AdminProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Auth guard                                                          */
/* ------------------------------------------------------------------ */

function RequireAuth() {
  const { session } = useAdmin();
  const location = useLocation();
  if (!session) return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

function LoginPage() {
  const { login, session, demo } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={location.state?.from ?? "/admin"} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // deliberate delay to blunt brute-force UX parity with server timing
    setTimeout(() => {
      const res = login(user.trim(), pass);
      setBusy(false);
      if (res.ok) navigate(location.state?.from ?? "/admin", { replace: true });
      else setError(res.error ?? "Invalid credentials");
    }, 350);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-eb-950 p-5">
      <div className="w-full max-w-sm">
        <div className="anim-fade-up rounded-3xl border border-eb-line bg-eb-900 p-8 shadow-2xl">
          <span className="mx-auto mb-6 flex h-13 w-13 items-center justify-center rounded-2xl bg-gradient-to-br from-eb-rose to-eb-violet font-display text-xl font-bold text-white shadow-lg shadow-eb-rose/30" style={{ height: 52, width: 52 }}>
            e
          </span>
          <h1 className="font-display text-center text-xl font-bold text-white">
            Ero<span className="text-gradient">Babe</span> Studio
          </h1>
          <p className="mt-1.5 mb-6 flex items-center justify-center gap-1.5 text-xs text-eb-muted">
            <Lock size={11} /> Restricted area — authorized administrators only
          </p>
          <form onSubmit={submit} className="space-y-3.5">
            <div>
              <label htmlFor="eb-user" className="mb-1.5 block text-xs font-semibold text-eb-muted">
                Username
              </label>
              <input
                id="eb-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="username"
                required
                className="ring-focus h-11 w-full rounded-xl border border-eb-line bg-eb-850 px-3.5 text-sm text-white outline-none transition focus:border-eb-rose/50"
              />
            </div>
            <div>
              <label htmlFor="eb-pass" className="mb-1.5 block text-xs font-semibold text-eb-muted">
                Password
              </label>
              <input
                id="eb-pass"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
                required
                className="ring-focus h-11 w-full rounded-xl border border-eb-line bg-eb-850 px-3.5 text-sm text-white outline-none transition focus:border-eb-rose/50"
              />
            </div>
            {error && <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-xs font-medium text-red-400">{error}</p>}
            <Button size="lg" className="w-full" disabled={busy}>
              {busy ? "Verifying…" : "Sign in"}
            </Button>
          </form>
          {demo && (
            <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3.5 py-3 text-[11px] leading-relaxed text-amber-300/90">
              <strong className="font-bold">Demo mode.</strong> Credentials: <code className="rounded bg-black/40 px-1">admin</code> / <code className="rounded bg-black/40 px-1">erobabe-demo</code>. In production this screen authenticates against the secure API with HttpOnly sessions — never localStorage.
            </div>
          )}
        </div>
        <Link to="/" className="mt-5 block text-center text-xs text-eb-faint transition hover:text-white">
          ← Back to erobabe.com
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const SIDE: { to: string; label: string; icon: typeof Film; end?: boolean }[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/videos", label: "Videos", icon: Film, end: true },
  { to: "/admin/videos/new", label: "New Upload", icon: Upload },
  { to: "/admin/categories", label: "Categories", icon: FolderOpen },
  { to: "/admin/tags", label: "Tags", icon: Tags },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/storage", label: "Storage", icon: HardDrive },
  { to: "/admin/activity", label: "Activity", icon: Activity },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

function AdminLayout() {
  const { session, state, logout, demo } = useAdmin();
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => setMobileNav(false), [location.pathname]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) navigate(`/admin/videos?q=${encodeURIComponent(query.trim())}`);
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-eb-line px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-eb-rose to-eb-violet font-display text-sm font-bold text-white">
          e
        </span>
        <div>
          <p className="font-display text-sm font-bold text-white">
            Ero<span className="text-gradient">Babe</span>
          </p>
          <p className="text-[9px] font-bold tracking-widest text-eb-faint uppercase">Studio CMS</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3 no-scrollbar" aria-label="Admin">
        {SIDE.map((s) => (
          <NavLink
            key={s.to + s.label}
            to={s.to}
            end={s.end}
            className={({ isActive }) =>
              cn(
                "ring-focus flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium transition",
                isActive ? "bg-white/7 text-white" : "text-eb-muted hover:bg-white/4 hover:text-white"
              )
            }
          >
            <s.icon size={16} className="shrink-0" />
            {s.label}
            {s.label === "Videos" && (
              <span className="ml-auto rounded-full bg-eb-800 px-2 py-0.5 text-[10px] font-bold text-eb-muted">{state.videos.length}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-eb-line p-3">
        <Link to="/" className="ring-focus flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-eb-muted transition hover:bg-white/4 hover:text-white">
          <ExternalLink size={16} /> View website
        </Link>
        <button onClick={logout} className="ring-focus flex w-full cursor-pointer items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-eb-muted transition hover:bg-red-500/10 hover:text-red-400">
          <LogOut size={16} /> Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-eb-950">
      {/* sidebar */}
      <aside className="fixed top-0 bottom-0 left-0 z-40 hidden w-60 border-r border-eb-line bg-eb-900 lg:block">{sidebar}</aside>

      {/* mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="anim-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileNav(false)} />
          <div className="anim-fade-up absolute top-0 bottom-0 left-0 w-64 border-r border-eb-line bg-eb-900">{sidebar}</div>
        </div>
      )}

      <div className="lg:pl-60">
        {/* topbar */}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-eb-line glass px-4 sm:px-6">
          <button onClick={() => setMobileNav(true)} aria-label="Open menu" className="ring-focus flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-eb-muted hover:bg-white/5 hover:text-white lg:hidden">
            {mobileNav ? <X size={18} /> : <Menu size={18} />}
          </button>
          <form onSubmit={onSearch} role="search" className="flex h-10 w-full max-w-md items-center gap-2 rounded-full border border-eb-line bg-eb-850 px-4 transition focus-within:border-eb-rose/50">
            <Search size={14} className="shrink-0 text-eb-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search videos, IDs, slugs, tags…"
              aria-label="Search admin videos"
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-eb-faint"
            />
          </form>
          <div className="ml-auto flex items-center gap-3">
            {demo && (
              <span className="hidden items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-400 uppercase sm:inline-flex">
                <Eye size={11} /> Demo mode
              </span>
            )}
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-eb-rose to-eb-violet text-xs font-bold text-white" title={session?.user}>
              {session?.user?.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared admin atoms                                                  */
/* ------------------------------------------------------------------ */

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-eb-muted">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-eb-line bg-eb-900/60", className)}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-eb-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-eb-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "ring-focus h-10 w-full rounded-xl border border-eb-line bg-eb-850 px-3.5 text-sm text-white outline-none transition focus:border-eb-rose/50 placeholder:text-eb-faint";
export const areaCls =
  "ring-focus w-full rounded-xl border border-eb-line bg-eb-850 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-eb-rose/50 placeholder:text-eb-faint";
