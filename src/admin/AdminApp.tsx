import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, NavLink, Outlet } from "react-router-dom";
import {
  BarChart3, Film, Flame, LayoutGrid, LogOut, Menu, Settings as SettingsIcon,
  ShieldCheck, UploadCloud, X, LayoutDashboard, Globe, type LucideIcon,
} from "lucide-react";
import { api } from "./api";
import { Logo } from "@/components/Brand";
import { applySEO } from "@/lib/seo";
import { cn } from "@/lib/format";

/* ── auth context ── */
interface AuthState {
  user: { username: string } | null;
  /** Password accepted, awaiting the TOTP code. */
  pending: boolean;
  twoFactorEnabled: boolean;
  checked: boolean;
  setPending: (v: boolean) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const AuthCtx = createContext<AuthState | null>(null);
export const useAuth = () => useContext(AuthCtx)!;

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.me();
      setUser(res.user);
      // A half-authenticated session survives refreshes, so the UI can
      // resume at the code step rather than asking for the password again.
      setPending(Boolean(res.twoFactorRequired) && !res.user);
      setTwoFactorEnabled(Boolean(res.twoFactorEnabled));
    } catch {
      setUser(null);
      setPending(false);
    } finally {
      setChecked(true);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* cookie expires anyway */
    }
    setUser(null);
    setPending(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const force = () => setUser(null);
    window.addEventListener("eb-admin-unauthorized", force);
    return () => window.removeEventListener("eb-admin-unauthorized", force);
  }, []);

  return (
    <AuthCtx.Provider
      value={{ user, pending, twoFactorEnabled, checked, setPending, refresh, logout }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

/* ── login ── */
function Login() {
  const { user, checked, refresh, pending, setPending } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (checked && user) {
    return <Navigate to={(location.state as { from?: string } | null)?.from ?? "/admin"} replace />;
  }

  const done = () =>
    navigate((location.state as { from?: string } | null)?.from ?? "/admin", { replace: true });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username.trim(), password);
      setPassword("");
      if (res.twoFactorRequired) {
        // Stop here — the session cannot reach the CMS until 2FA passes.
        setPending(true);
        setBusy(false);
        return;
      }
      await refresh();
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.verify2FA(code.trim());
      await refresh();
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setCode("");
      setBusy(false);
    }
  };

  /* ── Step 2: authenticator code ── */
  if (pending) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 p-4">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_20%,rgba(244,63,127,0.12),transparent_70%)]" aria-hidden />
        <form
          onSubmit={submitCode}
          className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-ink-900/80 p-8 shadow-2xl backdrop-blur-xl animate-scale-in"
        >
          <Logo />
          <div className="mt-6 flex items-center gap-2">
            <ShieldCheck className="size-4 text-brand-400" aria-hidden />
            <h1 className="text-lg font-semibold tracking-tight text-white">Two-factor verification</h1>
          </div>
          <p className="mt-1 text-xs text-fog-500">
            Enter the 6-digit code from your authenticator app, or one of your recovery codes.
          </p>

          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="one-time-code"
            inputMode="text"
            maxLength={20}
            placeholder="000000"
            aria-label="Verification code"
            className="mt-6 h-12 w-full rounded-xl border border-white/10 bg-ink-850 px-3.5 text-center text-lg font-semibold tracking-[0.3em] text-white outline-none transition focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
          />

          {error && (
            <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2.5 text-xs font-medium text-red-300" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || code.trim().length < 6}
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>

          <button
            type="button"
            onClick={async () => {
              await api.logout().catch(() => {});
              setPending(false);
              setError(null);
            }}
            className="mt-3 block w-full text-center text-[11px] font-medium text-fog-500 transition hover:text-white"
          >
            ← Start over
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 p-4">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_20%,rgba(244,63,127,0.12),transparent_70%)]" aria-hidden />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-ink-900/80 p-8 shadow-2xl backdrop-blur-xl animate-scale-in"
      >
        <div className="flex items-center justify-between">
          <Logo />
        </div>
        <h1 className="mt-6 text-lg font-semibold tracking-tight text-white">Admin sign in</h1>
        <p className="mt-1 text-xs text-fog-500">Restricted area — authorized staff only.</p>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fog-500">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-ink-850 px-3.5 text-sm text-white outline-none transition focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fog-500">Password</span>
            <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-ink-850 px-3.5 text-sm text-white outline-none transition focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2.5 text-xs font-medium text-red-300" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-fog-600">
          Credentials are configured via environment variables — see README.
        </p>
        <Link to="/" className="mt-3 block text-center text-[11px] font-medium text-fog-500 transition hover:text-white">
          ← Back to public site
        </Link>
      </form>
    </div>
  );
}

/* ── layout ── */
const NAV: { to: string; icon: LucideIcon; label: string; end?: boolean }[] = [
  { to: "/admin", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/admin/videos", icon: Film, label: "Videos" },
  { to: "/admin/upload", icon: UploadCloud, label: "Upload" },
  { to: "/admin/categories", icon: LayoutGrid, label: "Categories & Tags" },
  { to: "/admin/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/admin/security", icon: ShieldCheck, label: "Security" },
  { to: "/admin/seo", icon: Globe, label: "SEO Settings" },
  { to: "/admin/settings", icon: SettingsIcon, label: "Settings" },
];

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" onClick={onNavigate} aria-label="Admin navigation">
      {NAV.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition",
              isActive
                ? "bg-gradient-to-r from-brand-500/15 to-violet-600/10 text-white ring-1 ring-brand-500/25"
                : "text-fog-400 hover:bg-white/5 hover:text-white"
            )
          }
        >
          <Icon className="size-4.5" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function AdminLayout() {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-ink-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/6 bg-ink-900/50 backdrop-blur lg:flex">
        <div className="flex h-16 items-center border-b border-white/6 px-4">
          <Link to="/admin" aria-label="EroBabe admin">
            <Logo />
          </Link>
          <span className="ml-2 rounded-md bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-brand-300">CMS</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3.5">
          <SideNav />
        </div>
        <div className="border-t border-white/6 p-3.5">
          <div className="flex items-center justify-between gap-2 rounded-xl bg-ink-800/70 px-3.5 py-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{user?.username}</p>
              <p className="text-[10px] text-fog-600">Administrator</p>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              className="grid size-8.5 place-items-center rounded-lg text-fog-500 transition hover:bg-red-500/10 hover:text-red-400"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </div>
          <Link to="/" className="mt-2 flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium text-fog-500 transition hover:text-white">
            <Flame className="size-3.5" aria-hidden />
            View public site
          </Link>
        </div>
      </aside>

      {/* Mobile topbar */}
      <header className="glass sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-white/6 px-3 lg:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setNavOpen(true)}
          className="grid size-10 place-items-center rounded-full text-fog-400 hover:bg-white/5 hover:text-white"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Link to="/admin" className="ml-1"><Logo /></Link>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={logout}
          aria-label="Sign out"
          className="grid size-10 place-items-center rounded-full text-fog-400 hover:bg-white/5 hover:text-white"
        >
          <LogOut className="size-4.5" aria-hidden />
        </button>
      </header>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-[86] lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={() => setNavOpen(false)} />
          <div className="glass absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink-900/95 p-4 animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
              <Logo />
              <button type="button" aria-label="Close" onClick={() => setNavOpen(false)} className="grid size-9 place-items-center rounded-full text-fog-500 hover:bg-white/5 hover:text-white">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <SideNav onNavigate={() => setNavOpen(false)} />
            <Link to="/" className="mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium text-fog-500 hover:text-white">
              <Flame className="size-3.5" aria-hidden />
              View public site
            </Link>
          </div>
        </div>
      )}

      <main className="overflow-x-hidden lg:pl-60">
        <div className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/* ── guard ── */
function RequireAuth() {
  const { user, checked } = useAuth();
  const location = useLocation();
  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <div className="flex items-center gap-3 text-fog-500">
          <span className="size-6 animate-spin rounded-full border-2 border-fog-600 border-t-brand-400" aria-hidden />
          <span className="text-sm">Checking session…</span>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}

export default function AdminApp() {
  useEffect(() => {
    applySEO({ title: "Admin — EroBabe", robots: "noindex, nofollow" });
    return () => applySEO();
  }, []);

  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Lazy name="dashboard" />} />
            <Route path="videos" element={<Lazy name="videos" />} />
            <Route path="videos/:id" element={<Lazy name="edit" />} />
            <Route path="videos/:id/analytics" element={<Lazy name="videoAnalytics" />} />
            <Route path="upload" element={<Lazy name="upload" />} />
            <Route path="categories" element={<Lazy name="taxonomy" />} />
            <Route path="analytics" element={<Lazy name="analytics" />} />
            <Route path="security" element={<Lazy name="security" />} />
            <Route path="seo" element={<Lazy name="seoSettings" />} />
            <Route path="settings" element={<Lazy name="settings" />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}

/* Route-level code splitting inside the admin bundle. */
import { lazy, Suspense } from "react";
const Dashboard = lazy(() => import("./Dashboard"));
const VideosList = lazy(() => import("./VideosList"));
const VideoEdit = lazy(() => import("./VideoEdit"));
const UploadWizard = lazy(() => import("./UploadWizard"));
const Taxonomy = lazy(() => import("./Taxonomy"));
const Analytics = lazy(() => import("./Analytics"));
const Settings = lazy(() => import("./Settings"));
const VideoAnalytics = lazy(() => import("./VideoAnalytics"));
const Security = lazy(() => import("./Security"));
const SeoSettings = lazy(() => import("./SeoSettings"));

function Lazy({ name }: { name: "dashboard" | "videos" | "edit" | "upload" | "taxonomy" | "analytics" | "settings" | "videoAnalytics" | "security" | "seoSettings" }) {
  const map = { dashboard: Dashboard, videos: VideosList, edit: VideoEdit, upload: UploadWizard, taxonomy: Taxonomy, analytics: Analytics, settings: Settings, videoAnalytics: VideoAnalytics, security: Security, seoSettings: SeoSettings };
  const C = map[name];
  return (
    <Suspense fallback={<div className="flex items-center gap-3 py-20 text-fog-500"><span className="size-5 animate-spin rounded-full border-2 border-fog-600 border-t-brand-400" /><span className="text-sm">Loading…</span></div>}>
      <C />
    </Suspense>
  );
}
